import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoundedBackoff } from "./backoff";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { CoreOpsContext, type OpsSelectedPoint } from "./CoreOpsContext";
import { fabricWsUrl, fetchCoreHealth, fetchFabricRest, fetchStormIntelHealth, fetchStormIntelPoint, normalizeFabricWsEvent } from "./client";
import { fabricStateFromSnapshot } from "./fabricSnapshot";
import { LatestRequestGate } from "./requestGate";
import type { OpsCoreState } from "./types";

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
      wsState: "disabled",
      lastWsEventAt: null,
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
      const [core, fabric, stormIntelHealth] = await Promise.all([
        fetchCoreHealth(config),
        fetchFabricRest(config, fabricRef.current),
        fetchStormIntelHealth(config),
      ]);
      if (cancelled) return;
      setState((current) => ({
        ...current,
        core,
        fabric: {
          ...fabric,
          units: current.fabric.units ?? fabric.units,
          wsState: current.fabric.wsState,
          lastWsEventAt: current.fabric.lastWsEventAt,
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
    if (!coreConfigured(config) || !config.coreWsUrl) return;
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;
    const backoff = new BoundedBackoff();

    const connect = () => {
      if (cancelled) return;
      setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "connecting", error: null } }));
      socket = new WebSocket(fabricWsUrl(config));
      socket.onopen = () => {
        backoff.reset();
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "open", lastContactAt: Date.now(), error: null } }));
      };
      socket.onmessage = (message) => {
        try {
          const event = normalizeFabricWsEvent(String(message.data));
          setState((current) => {
            const snapshot = event.eventType === "fabric.snapshot" ? fabricStateFromSnapshot(event.payload) : null;
            return {
              ...current,
              fabric: {
                ...current.fabric,
                state: "LIVE",
                detail: snapshot ? `Fabric WebSocket snapshot; ${snapshot.units.length} registered units` : `Fabric WebSocket event: ${event.eventType}`,
                units: snapshot ?? current.fabric.units,
                wsState: "open",
                lastWsEventAt: Date.now(),
                lastContactAt: Date.now(),
                error: null,
              },
            };
          });
        } catch (error) {
          setState((current) => ({
            ...current,
            fabric: {
              ...current.fabric,
              state: "DEGRADED",
              wsState: "error",
              error: error instanceof Error ? error.message : "Malformed Fabric WebSocket event",
              lastContactAt: Date.now(),
            },
          }));
        }
      };
      socket.onerror = () => {
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "error", error: "Fabric WebSocket error" } }));
      };
      socket.onclose = () => {
        if (cancelled) return;
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "closed", state: current.fabric.state === "LIVE" ? "STALE" : current.fabric.state } }));
        reconnectTimer = window.setTimeout(connect, backoff.next());
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
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

  const value = useMemo(() => ({ config, state, selectedPoint, selectPoint }), [config, state, selectedPoint, selectPoint]);
  return <CoreOpsContext.Provider value={value}>{children}</CoreOpsContext.Provider>;
}
