import { useEffect, useMemo, useRef, useState } from "react";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { fabricWsUrl, fetchCoreHealth, fetchFabricState, fetchStormIntelHealth } from "./client";
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
    },
    stormIntel: {
      state: "CHECKING",
      detail: "Storm Intel check pending",
      checkedAt: now,
      health: null,
      selectedPoint: null,
      pointSnapshot: null,
      pointError: null,
    },
  };
}

export function useCoreOps(selectedPoint: { lat: number; lon: number } | null) {
  const config = useMemo(() => readOpsCoreConfig(), []);
  const [state, setState] = useState<OpsCoreState>(() => initialState());
  const fabricRef = useRef(state.fabric);

  useEffect(() => {
    fabricRef.current = state.fabric;
  }, [state.fabric]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const [core, fabric, stormIntel] = await Promise.all([
        fetchCoreHealth(config),
        fetchFabricState(config, fabricRef.current),
        fetchStormIntelHealth(config, selectedPoint),
      ]);
      if (!cancelled) setState((current) => ({ ...current, core, fabric: { ...fabric, wsState: current.fabric.wsState, lastWsEventAt: current.fabric.lastWsEventAt }, stormIntel, refreshedAt: Date.now() }));
    }
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [config, selectedPoint]);

  useEffect(() => {
    if (!coreConfigured(config) || !config.coreWsUrl) return;
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let backoff = 2_000;

    const connect = () => {
      if (cancelled) return;
      setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "connecting" } }));
      socket = new WebSocket(fabricWsUrl(config));
      socket.onopen = () => {
        backoff = 2_000;
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "open", lastWsEventAt: Date.now() } }));
      };
      socket.onmessage = () => {
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "open", lastWsEventAt: Date.now() } }));
      };
      socket.onerror = () => {
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "error" } }));
      };
      socket.onclose = () => {
        if (cancelled) return;
        setState((current) => ({ ...current, fabric: { ...current.fabric, wsState: "closed" } }));
        reconnectTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [config]);

  return { config, state };
}
