import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoundedBackoff } from "./backoff";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { CoreOpsContext, type OpsSelectedPoint } from "./CoreOpsContext";
import { consumeFabricStream, fetchCoreHealth, fetchFabricRest, fetchStormIntelHealth, fetchStormIntelPoint } from "./client";
import { fabricStateFromSnapshot } from "./fabricSnapshot";
import { LatestRequestGate } from "./requestGate";
import { mergeStormHealth, shouldRefreshPoint } from "./pointRefresh";
import { addPointHistoryEntry, historyEntryFromSnapshot } from "../stormIntel/pointHistory";
import type { OpsCoreState } from "./types";

const FABRIC_STREAM_FRESH_MS = 10_000;

function initialState(): OpsCoreState {
  const now = Date.now();
  return {
    refreshedAt: now,
    core: { state: "CHECKING", detail: "Core check pending", checkedAt: now },
    fabric: {
      state: "CHECKING",
      detail: "Fabric check pending",
      checkedAt: now,
      health: null,
      units: null,
      streamState: "disabled",
      lastStreamEventAt: null,
      lastContactAt: null,
      error: null,
    },
    stormIntel: {
      state: "CHECKING",
      detail: "Storm Intel check pending",
      checkedAt: now,
      health: null,
      selectedPoint: null,
      pointLoading: false,
      requestId: 0,
      pointSnapshot: null,
      pointError: null,
      pointHistory: [],
    },
  };
}

export function CoreOpsProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => readOpsCoreConfig(), []);
  const [state, setState] = useState<OpsCoreState>(() => initialState());
  const [selectedPoint, setSelectedPoint] = useState<OpsSelectedPoint | null>(null);
  const [locationMode, setLocationMode] = useState<"follow" | "manual">("follow");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const devicePointRef = useRef<OpsSelectedPoint | null>(null);
  const lastRequestedRef = useRef<{ point: OpsSelectedPoint | null; at: number }>({ point: null, at: 0 });
  const fabricRef = useRef(state.fabric);
  const pointRequestRef = useRef(new LatestRequestGate());

  useEffect(() => {
    fabricRef.current = state.fabric;
  }, [state.fabric]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const [core, stormIntelHealth] = await Promise.all([fetchCoreHealth(config), fetchStormIntelHealth(config)]);
      inFlight = false;
      if (cancelled) return;

      // REST remains a fallback whenever the authenticated feed is disconnected or stale.
      const fabricNow = fabricRef.current;
      const streamHealthy =
        fabricNow.streamState === "open" &&
        fabricNow.lastStreamEventAt !== null &&
        Date.now() - fabricNow.lastStreamEventAt < FABRIC_STREAM_FRESH_MS;

      if (streamHealthy) {
        setState((current) => ({ ...current, core, stormIntel: mergeStormHealth(current.stormIntel, stormIntelHealth), refreshedAt: Date.now() }));
        return;
      }

      inFlight = true;
      const fabric = await fetchFabricRest(config, fabricRef.current);
      inFlight = false;
      if (cancelled) return;
      setState((current) => ({
        ...current,
        core,
        fabric: {
          ...fabric,
          units: current.fabric.streamState === "open" && current.fabric.lastStreamEventAt !== null && Date.now() - current.fabric.lastStreamEventAt < FABRIC_STREAM_FRESH_MS
            ? current.fabric.units : fabric.units,
          streamState: current.fabric.streamState,
          lastStreamEventAt: current.fabric.lastStreamEventAt,
          lastContactAt: current.fabric.lastContactAt ?? fabric.lastContactAt,
          error: current.fabric.error,
        },
        stormIntel: mergeStormHealth(current.stormIntel, stormIntelHealth),
        refreshedAt: Date.now(),
      }));
    }
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [config]);

  useEffect(() => {
    if (!coreConfigured(config)) return;
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let controller: AbortController | null = null;
    let watchdog: number | null = null;
    const backoff = new BoundedBackoff();

    const connect = () => {
      if (cancelled) return;
      controller = new AbortController();
      setState((current) => ({ ...current, fabric: { ...current.fabric, streamState: "connecting", error: null } }));
      watchdog = window.setTimeout(() => controller?.abort(), FABRIC_STREAM_FRESH_MS);
      void consumeFabricStream(config, controller.signal, (event) => {
        if (cancelled || event.eventType !== "fabric.snapshot") return;
        const snapshot = fabricStateFromSnapshot(event.payload);
        if (!snapshot) throw new Error("Malformed Fabric snapshot");
        if (watchdog !== null) window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => controller?.abort(), FABRIC_STREAM_FRESH_MS);
        backoff.reset();
        setState((current) => ({
          ...current,
          fabric: {
            ...current.fabric,
            state: "LIVE",
            detail: `Fabric live feed; ${snapshot.units.length} registered units`,
            units: snapshot,
            streamState: "open",
            lastStreamEventAt: Date.now(),
            lastContactAt: Date.now(),
            error: null,
          },
        }));
      }).catch((error: unknown) => {
        if (cancelled) return;
        setState((current) => ({ ...current, fabric: {
          ...current.fabric,
          streamState: "error",
          error: error instanceof Error ? error.message : "Fabric live feed failed",
        } }));
      }).finally(() => {
        if (watchdog !== null) window.clearTimeout(watchdog);
        if (cancelled) return;
        setState((current) => ({ ...current, fabric: {
          ...current.fabric,
          streamState: "closed",
          state: current.fabric.state === "LIVE" ? "STALE" : current.fabric.state,
        } }));
        reconnectTimer = window.setTimeout(connect, backoff.next());
      });
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (watchdog !== null) window.clearTimeout(watchdog);
      controller?.abort();
    };
  }, [config]);

  useEffect(() => {
    const requestId = pointRequestRef.current.next();
    if (!selectedPoint) {
      setState((current) => ({
        ...current,
        stormIntel: {
          ...current.stormIntel,
          selectedPoint: null,
          state: "CHECKING",
          detail: "Choose a location for model data.",
          pointLoading: false,
          requestId,
          pointSnapshot: null,
          snapshotPoint: null,
          pointError: null,
        },
      }));
      return;
    }

    const controller = new AbortController();
    lastRequestedRef.current = { point: selectedPoint, at: Date.now() };
    setState((current) => ({
      ...current,
      stormIntel: {
        ...current.stormIntel,
        selectedPoint,
        state: coreConfigured(config) ? "CHECKING" : "UNAVAILABLE",
        detail: coreConfigured(config) ? "Loading model data…" : "Model service is not configured.",
        pointLoading: coreConfigured(config),
        requestId,
        pointError: coreConfigured(config) ? null : "Model service is not configured.",
      },
    }));

    if (!coreConfigured(config)) return;
    void fetchStormIntelPoint(config, selectedPoint, controller.signal)
      .then((snapshot) => {
        if (!pointRequestRef.current.isCurrent(requestId) || controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          stormIntel: {
            ...current.stormIntel,
            state: snapshot.available ? "LIVE" : "UNAVAILABLE",
            detail: snapshot.available ? "Storm Intel point snapshot ready" : (snapshot.unavailableReason ?? "Storm Intel point unavailable"),
            checkedAt: Date.now(),
            selectedPoint,
            pointLoading: false,
            requestId,
            pointSnapshot: snapshot.available ? snapshot : current.stormIntel.pointSnapshot,
            snapshotPoint: snapshot.available ? selectedPoint : current.stormIntel.snapshotPoint,
            pointError: snapshot.available ? null : (snapshot.unavailableReason ?? "Model data unavailable for this point."),
            pointHistory: snapshot.available
              ? addPointHistoryEntry(current.stormIntel.pointHistory, historyEntryFromSnapshot(selectedPoint, snapshot))
              : current.stormIntel.pointHistory,
          },
        }));
      })
      .catch((error) => {
        if (!pointRequestRef.current.isCurrent(requestId) || controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          stormIntel: {
            ...current.stormIntel,
            state: "DEGRADED",
            detail: "Storm Intel point request failed",
            checkedAt: Date.now(),
            selectedPoint,
            pointLoading: false,
            requestId,
            pointError: error instanceof Error ? error.message : "point request failed",
          },
        }));
      });
    return () => controller.abort();
  }, [config, selectedPoint, refreshNonce]);

  const updateDeviceLocation = useCallback((point: OpsSelectedPoint) => {
    devicePointRef.current = point;
    if (locationMode !== "follow" || document.hidden) return;
    const last = lastRequestedRef.current;
    if (shouldRefreshPoint(last.point, point, Date.now() - last.at)) setSelectedPoint({ ...point });
  }, [locationMode]);

  useEffect(() => {
    const refresh = () => {
      if (devicePointRef.current) updateDeviceLocation(devicePointRef.current);
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [updateDeviceLocation]);

  const followDeviceLocation = useCallback(() => {
    setLocationMode("follow");
    if (devicePointRef.current) setSelectedPoint({ ...devicePointRef.current });
  }, []);
  const refreshPoint = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const selectPoint = useCallback((point: OpsSelectedPoint | null) => {
    setLocationMode(point ? "manual" : "follow");
    setSelectedPoint(point);
  }, []);

  const selectHistoryPoint = useCallback((entry: { requested: OpsSelectedPoint }) => {
    setLocationMode("manual");
    setSelectedPoint(entry.requested);
  }, []);

  const value = useMemo(
    () => ({
      config,
      state,
      selectedPoint,
      pointHistory: state.stormIntel.pointHistory,
      locationMode,
      updateDeviceLocation,
      followDeviceLocation,
      refreshPoint,
      selectPoint,
      selectHistoryPoint,
    }),
    [config, state, selectedPoint, selectPoint, selectHistoryPoint, locationMode, updateDeviceLocation, followDeviceLocation, refreshPoint],
  );
  return <CoreOpsContext.Provider value={value}>{children}</CoreOpsContext.Provider>;
}
