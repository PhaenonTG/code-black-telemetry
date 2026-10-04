import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoundedBackoff } from "./backoff";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { CoreOpsContext, type OpsSelectedPoint } from "./CoreOpsContext";
import { consumeFabricStream, fetchCoreHealth, fetchFabricRest, fetchStormIntelHealth, fetchStormIntelPoint } from "./client";
import { fabricStateFromSnapshot } from "./fabricSnapshot";
import { LatestRequestGate } from "./requestGate";
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
  const fabricRef = useRef(state.fabric);
  const pointRequestRef = useRef(new LatestRequestGate());

  useEffect(() => {
    fabricRef.current = state.fabric;
  }, [state.fabric]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const core = await fetchCoreHealth(config);
      if (cancelled) return;

      // REST remains a fallback whenever the authenticated feed is disconnected or stale.
      const fabricNow = fabricRef.current;
      const streamHealthy =
        fabricNow.streamState === "open" &&
        fabricNow.lastStreamEventAt !== null &&
        Date.now() - fabricNow.lastStreamEventAt < FABRIC_STREAM_FRESH_MS;

      if (streamHealthy) {
        setState((current) => ({ ...current, core, refreshedAt: Date.now() }));
        return;
      }

      const [fabric, stormIntelHealth] = await Promise.all([
        fetchFabricRest(config, fabricRef.current),
        fetchStormIntelHealth(config),
      ]);
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
        stormIntel: {
          ...current.stormIntel,
          ...stormIntelHealth,
        },
        refreshedAt: Date.now(),
      }));
    }
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
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
          pointLoading: false,
          requestId,
          pointSnapshot: null,
          pointError: null,
        },
      }));
      return;
    }

    const controller = new AbortController();
    setState((current) => ({
      ...current,
      stormIntel: {
        ...current.stormIntel,
        selectedPoint,
        pointLoading: coreConfigured(config),
        requestId,
        pointSnapshot: null,
        pointError: coreConfigured(config) ? null : current.stormIntel.detail,
      },
    }));

    if (!coreConfigured(config)) return;
    void fetchStormIntelPoint(config, selectedPoint, controller.signal)
      .then((snapshot) => {
        if (!pointRequestRef.current.isCurrent(requestId)) return;
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
            pointSnapshot: snapshot,
            pointError: snapshot.available ? null : snapshot.unavailableReason,
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
            pointSnapshot: null,
            pointError: error instanceof Error ? error.message : "point request failed",
          },
        }));
      });
    return () => controller.abort();
  }, [config, selectedPoint]);

  const selectPoint = useCallback((point: OpsSelectedPoint | null) => {
    setSelectedPoint(point);
  }, []);

  const selectHistoryPoint = useCallback((entry: { requested: OpsSelectedPoint }) => {
    setSelectedPoint(entry.requested);
  }, []);

  const value = useMemo(
    () => ({
      config,
      state,
      selectedPoint,
      pointHistory: state.stormIntel.pointHistory,
      selectPoint,
      selectHistoryPoint,
    }),
    [config, state, selectedPoint, selectPoint, selectHistoryPoint],
  );
  return <CoreOpsContext.Provider value={value}>{children}</CoreOpsContext.Provider>;
}
