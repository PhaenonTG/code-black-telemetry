import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoundedBackoff } from "./backoff";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { CoreOpsContext, type OpsSelectedPoint } from "./CoreOpsContext";
import { consumeFabricStream, fetchCoreHealth, fetchFabricRest, fetchStormIntelHealth, fetchStormIntelPoint } from "./client";
import { planFabricReconnect } from "./fabricReconnect";
import { fabricStateFromSnapshot } from "./fabricSnapshot";
import { LatestRequestGate } from "./requestGate";
import { mergeStormHealth, shouldRefreshPoint } from "./pointRefresh";
import { addPointHistoryEntry, historyEntryFromSnapshot } from "../stormIntel/pointHistory";
import type { OpsCoreState } from "./types";
import { browserLocationAdapter, type LocationState } from "../adapters/LocationAdapter";
import { liveChaserFix, PEA_RIDGE_REFERENCE, retainedChaserFix, type LiveChaserFix, type LocationMode } from "./referenceLocation";

const FABRIC_STREAM_FRESH_MS = 10_000;
const REFERENCE_KEY = "codeblack.ops.locationReference.v1";
function savedReference(): { mode: LocationMode; unitId: string } {
  try {
    const value = JSON.parse(localStorage.getItem(REFERENCE_KEY) ?? "null");
    if (value?.mode === "chaser" && typeof value.unitId === "string") return { mode: "chaser", unitId: value.unitId };
    if (value?.mode === "fallback") return { mode: "fallback", unitId: "" };
  } catch { /* Default to browser location with Pea Ridge fallback. */ }
  return { mode: "follow", unitId: "" };
}

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
  const [saved] = useState(savedReference);
  const [selectedPoint, setSelectedPoint] = useState<OpsSelectedPoint | null>(PEA_RIDGE_REFERENCE);
  const [locationMode, setLocationMode] = useState<LocationMode>(saved.mode);
  const [referenceUnitId, setReferenceUnitId] = useState(saved.unitId);
  const [deviceLocation, setDeviceLocation] = useState<LocationState>({ status: "requesting" });
  const [lastChaserFixes, setLastChaserFixes] = useState<Record<string, LiveChaserFix>>({});
  const [referenceNow, setReferenceNow] = useState(Date.now);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const referenceSourceRef = useRef(`${saved.mode}:${saved.unitId}:true`);
  const lastRequestedRef = useRef<{ point: OpsSelectedPoint | null; at: number }>({ point: null, at: 0 });
  const fabricRef = useRef(state.fabric);
  const pointRequestRef = useRef(new LatestRequestGate());

  useEffect(() => browserLocationAdapter.watch(setDeviceLocation), []);
  useEffect(() => {
    const refresh = () => setReferenceNow(Date.now());
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (locationMode === "manual") return;
    try { localStorage.setItem(REFERENCE_KEY, JSON.stringify({ mode: locationMode, unitId: referenceUnitId })); } catch { /* Session choice still works. */ }
  }, [locationMode, referenceUnitId]);

  const referenceUnit = state.fabric.units?.units.find((unit) => unit.unit_id === referenceUnitId);
  const chaserFix = useMemo(() => referenceUnit ? liveChaserFix(referenceUnit, referenceNow) : null, [referenceUnit, referenceNow]);
  useEffect(() => {
    if (!referenceUnitId || !chaserFix) return;
    // This intentionally snapshots an external GPS observation for outage continuity.
    // oxlint-disable-next-line react/set-state-in-effect
    setLastChaserFixes((current) => {
      const prior = current[referenceUnitId];
      return prior?.point.lat === chaserFix.point.lat && prior.point.lon === chaserFix.point.lon && prior.observedAt === chaserFix.observedAt
        ? current
        : { ...current, [referenceUnitId]: chaserFix };
    });
  }, [chaserFix, referenceUnitId]);
  const selectedChaserFix = retainedChaserFix(chaserFix, lastChaserFixes[referenceUnitId] ?? null);
  const selectedChaserPoint = selectedChaserFix?.point ?? null;
  const deviceReady = deviceLocation.status === "ready" && referenceNow - deviceLocation.at <= 120_000;
  const referenceIsFallback = locationMode === "fallback" || (locationMode === "follow" && !deviceReady) || (locationMode === "chaser" && !selectedChaserFix);
  const referenceIsStale = locationMode === "chaser" && Boolean(selectedChaserFix) && !chaserFix;
  const referenceLabel = locationMode === "manual" ? "Map point"
    : locationMode === "fallback" ? "Pea Ridge, AR"
    : locationMode === "chaser" ? `${referenceUnit?.operator_name || referenceUnit?.display_name || "Chaser"}${chaserFix ? " · GPS" : selectedChaserPoint ? " · last known GPS" : " · waiting for GPS"}`
    : deviceReady ? "My location · GPS" : "Pea Ridge, AR · fallback";

  useEffect(() => {
    if (locationMode === "manual" || document.hidden) return;
    // A selected chaser owns this reference until the operator changes it. A brief telemetry
    // dropout must not substitute the browser/default position and bounce both Chase maps away
    // from that operator; retain the last verified fix while clearly labeling it as last known.
    const target = locationMode === "chaser" ? selectedChaserPoint ?? PEA_RIDGE_REFERENCE
      : locationMode === "follow" && deviceReady && deviceLocation.status === "ready" ? { lat: deviceLocation.lat, lon: deviceLocation.lon }
      : PEA_RIDGE_REFERENCE;
    const source = `${locationMode}:${referenceUnitId}:${referenceIsFallback}`;
    const last = lastRequestedRef.current;
    if (source !== referenceSourceRef.current || shouldRefreshPoint(last.point, target, Date.now() - last.at)) {
      referenceSourceRef.current = source;
      setSelectedPoint({ ...target });
    }
  }, [locationMode, referenceUnitId, referenceIsFallback, deviceLocation, deviceReady, selectedChaserPoint, referenceNow]);

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
    let activeController: AbortController | null = null;
    let clearActiveWatchdog: (() => void) | null = null;
    const backoff = new BoundedBackoff();

    const connect = () => {
      if (cancelled) return;
      const controller = new AbortController();
      activeController = controller;
      let watchdog: number | null = null;
      let completedNormally = false;
      let receivedSnapshot = false;
      let streamError: string | null = null;
      const clearWatchdog = () => {
        if (watchdog !== null) window.clearTimeout(watchdog);
        watchdog = null;
      };
      const armWatchdog = () => {
        clearWatchdog();
        watchdog = window.setTimeout(() => controller.abort(), FABRIC_STREAM_FRESH_MS);
      };
      clearActiveWatchdog = clearWatchdog;
      setState((current) => current.fabric.streamState === "open" || current.fabric.streamState === "closed"
        ? current
        : { ...current, fabric: { ...current.fabric, streamState: "connecting", error: null } });
      armWatchdog();
      void consumeFabricStream(config, controller.signal, (event) => {
        if (cancelled || event.eventType !== "fabric.snapshot") return;
        const snapshot = fabricStateFromSnapshot(event.payload);
        if (!snapshot) throw new Error("Malformed Fabric snapshot");
        receivedSnapshot = true;
        armWatchdog();
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
      }).then(() => {
        completedNormally = true;
      }).catch((error: unknown) => {
        streamError = error instanceof Error ? error.message : "Fabric live feed failed";
      }).finally(() => {
        clearWatchdog();
        if (activeController === controller) {
          activeController = null;
          clearActiveWatchdog = null;
        }
        if (cancelled) return;
        const plan = planFabricReconnect(completedNormally, receivedSnapshot, () => backoff.next());
        if (plan.markClosed) {
          setState((current) => ({ ...current, fabric: {
            ...current.fabric,
            streamState: "closed",
            state: current.fabric.state === "LIVE" ? "STALE" : current.fabric.state,
            error: streamError ?? "Fabric feed closed before its first snapshot",
          } }));
        }
        reconnectTimer = window.setTimeout(connect, plan.delayMs);
      });
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearActiveWatchdog?.();
      activeController?.abort();
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
    setDeviceLocation({ status: "ready", ...point, accuracyM: 0, headingDeg: null, speedMph: null, at: Date.now() });
  }, []);

  const followDeviceLocation = useCallback(() => {
    referenceSourceRef.current = "";
    setLocationMode("follow");
    setReferenceUnitId("");
    void browserLocationAdapter.getCurrent().then(setDeviceLocation);
  }, []);
  const chooseChaserLocation = useCallback((unitId: string) => {
    referenceSourceRef.current = "";
    setReferenceUnitId(unitId);
    setLocationMode("chaser");
  }, []);
  const chooseFallbackLocation = useCallback(() => {
    referenceSourceRef.current = "";
    setReferenceUnitId("");
    setLocationMode("fallback");
    setSelectedPoint({ ...PEA_RIDGE_REFERENCE });
  }, []);
  const refreshPoint = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const selectPoint = useCallback((point: OpsSelectedPoint | null) => {
    referenceSourceRef.current = "";
    setLocationMode(point ? "manual" : "follow");
    setSelectedPoint(point ?? { ...PEA_RIDGE_REFERENCE });
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
      deviceLocation,
      referenceUnitId,
      referenceLabel,
      referenceIsFallback,
      referenceIsStale,
      referenceChaserFix: locationMode === "chaser" ? selectedChaserFix : null,
      chooseChaserLocation,
      chooseFallbackLocation,
      updateDeviceLocation,
      followDeviceLocation,
      refreshPoint,
      selectPoint,
      selectHistoryPoint,
    }),
    [config, state, selectedPoint, selectPoint, selectHistoryPoint, locationMode, deviceLocation, referenceUnitId, referenceLabel, referenceIsFallback, referenceIsStale, selectedChaserFix, chooseChaserLocation, chooseFallbackLocation, updateDeviceLocation, followDeviceLocation, refreshPoint],
  );
  return <CoreOpsContext.Provider value={value}>{children}</CoreOpsContext.Provider>;
}
