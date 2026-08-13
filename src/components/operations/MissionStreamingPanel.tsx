import { useCallback, useEffect, useMemo, useState } from "react";
import { useResumeTick } from "../../hooks/useResumeTick";
import { loadBleCommandToken, loadPiEndpoint, subscribeBleCommandToken, subscribePiEndpoint } from "../../services/settings";
import {
  emptyMissionStreamStatus,
  getMissionStreamStatus,
  sendStreamControl,
  type MissionStreamStatus,
  type StreamControlTarget,
  type StreamState,
  type StreamTargetStatus,
} from "../../services/streaming";
import { bleTelemetryClient } from "../../services/telemetry/ble-client";
import { Panel } from "../situational/Panel";

type PendingCommand = { target: StreamControlTarget; action: "start" | "stop" } | null;

const POLL_MS = 3_000;
const STALE_MS = 10_000;

function isDesiredOn(status: StreamTargetStatus) {
  return status.desiredOn || status.state === "STARTING" || status.state === "LIVE" || status.state === "DEGRADED" || status.state === "RECONNECTING";
}

function toneFor(state: StreamState | "UNKNOWN") {
  if (state === "LIVE") return "ok";
  if (state === "DEGRADED" || state === "RECONNECTING" || state === "STARTING") return "warn";
  if (state === "FAILED") return "bad";
  return "neutral";
}

function displayLabel(target: StreamControlTarget, state: StreamState | "UNKNOWN") {
  if (target === "recording" && state === "LIVE") return "RECORDING";
  return state;
}

function compactMetric(status: StreamTargetStatus) {
  const parts = [
    status.bitrateKbps ? `${Math.round(status.bitrateKbps)} kbps` : "",
    status.resolution,
    status.fps ? `${Math.round(status.fps)} fps` : "",
    status.reconnectCount ? `${status.reconnectCount} reconnects` : "",
  ].filter(Boolean);
  return parts.slice(0, 2).join(" - ");
}

function StreamRow({
  label,
  target,
  status,
  stale,
  pending,
  disabled,
  onToggle,
}: {
  label: string;
  target: StreamControlTarget;
  status: StreamTargetStatus;
  stale: boolean;
  pending: PendingCommand;
  disabled: boolean;
  onToggle: (target: StreamControlTarget, nextOn: boolean) => void;
}) {
  const pendingHere = pending?.target === target;
  const checked = pendingHere && pending.action === "start" ? true : isDesiredOn(status);
  const displayState: StreamState | "UNKNOWN" = pendingHere && pending.action === "start" ? "STARTING" : stale ? "UNKNOWN" : status.state;
  const metric = stale && !pendingHere ? "" : compactMetric(status);
  const note = stale && !pendingHere ? "STATUS UNKNOWN" : pendingHere ? "COMMAND IN FLIGHT" : status.error || status.storageWarning || metric;
  return (
    <div className="stream-row">
      <div className="stream-row__label">
        <strong>{label}</strong>
        {note && <span>{note}</span>}
      </div>
      <span className={`stream-state stream-state--${toneFor(displayState)}`}>{displayLabel(target, displayState)}</span>
      <button
        type="button"
        className={checked ? "stream-switch stream-switch--on" : "stream-switch"}
        aria-pressed={checked}
        disabled={disabled || pendingHere}
        onClick={() => onToggle(target, !checked)}
      >
        <span aria-hidden="true" />
        <em>{checked ? "ON" : "OFF"}</em>
      </button>
    </div>
  );
}

export function MissionStreamingPanel() {
  const [status, setStatus] = useState<MissionStreamStatus>(() => emptyMissionStreamStatus("Waiting for Pi stream status."));
  const [pending, setPending] = useState<PendingCommand>(null);
  const [message, setMessage] = useState("");
  const [bleConnected, setBleConnected] = useState(() => bleTelemetryClient.isConnected());
  const [hasToken, setHasToken] = useState(false);
  const [endpointTick, setEndpointTick] = useState(0);
  const resumeTick = useResumeTick();

  const stale = status.stale || !status.fetchedAt || Date.now() - status.fetchedAt > STALE_MS;
  const controlsDisabled = Boolean(pending) || !hasToken;

  const cameraLine = useMemo(() => {
    const details = [status.camera.resolution, status.camera.fps ? `${Math.round(status.camera.fps)} fps` : ""].filter(Boolean).join(" - ");
    return status.camera.error || details || (stale ? "STATUS UNKNOWN" : "INGEST");
  }, [status.camera.error, status.camera.fps, status.camera.resolution, stale]);

  const refresh = useCallback(async (clearMessage = true) => {
    try {
      const next = await getMissionStreamStatus();
      setStatus(next);
      if (clearMessage) setMessage("");
    } catch (error) {
      setStatus((current) => ({
        ...current,
        stale: true,
        error: error instanceof Error ? error.message : "Pi stream status unavailable",
      }));
    }
  }, []);

  useEffect(() => {
    void loadPiEndpoint().then(() => setEndpointTick((tick) => tick + 1));
    void loadBleCommandToken().then((token) => setHasToken(Boolean(token)));
    const unsubscribeEndpoint = subscribePiEndpoint(() => setEndpointTick((tick) => tick + 1));
    const unsubscribeToken = subscribeBleCommandToken((token) => setHasToken(Boolean(token)));
    const unsubscribeBle = bleTelemetryClient.subscribe((_payload, connected) => setBleConnected(connected));
    return () => {
      unsubscribeEndpoint();
      unsubscribeToken();
      unsubscribeBle();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await refresh();
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // endpointTick and resumeTick intentionally force immediate refreshes on endpoint changes and app resume.
  }, [endpointTick, refresh, resumeTick]);

  const toggle = async (target: StreamControlTarget, nextOn: boolean) => {
    if (pending) return;
    const action = nextOn ? "start" : "stop";
    setPending({ target, action });
    setMessage(nextOn ? "Starting stream..." : "Stop command sent. Waiting for Pi state.");
    try {
      const result = await sendStreamControl(target, action, bleConnected);
      setMessage(result.message);
      await refresh(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stream command failed.");
      await refresh(false);
    } finally {
      setPending(null);
    }
  };

  const cameraTone = stale ? "neutral" : status.camera.available ? "ok" : status.camera.available === false ? "bad" : "neutral";

  return (
    <Panel title="Mission Streaming" className="ops-stream-panel">
      <div className="stream-panel-body">
        <div className="stream-row stream-row--camera">
          <div className="stream-row__label">
            <strong>Camera</strong>
            <span>{cameraLine}</span>
          </div>
          <span className={`stream-state stream-state--${cameraTone}`}>{stale ? "UNKNOWN" : status.camera.label}</span>
        </div>
        <StreamRow label="KNWA" target="knwa" status={status.knwa} stale={stale} pending={pending} disabled={controlsDisabled} onToggle={toggle} />
        <StreamRow label="Code Black" target="codeBlack" status={status.codeBlack} stale={stale} pending={pending} disabled={controlsDisabled} onToggle={toggle} />
        <StreamRow label="REC" target="recording" status={status.recording} stale={stale} pending={pending} disabled={controlsDisabled} onToggle={toggle} />
        {(message || status.error || !hasToken) && (
          <div className={status.error || !hasToken ? "stream-message stream-message--warn" : "stream-message"}>
            {!hasToken ? "Set command token in Settings before stream controls." : message || status.error}
          </div>
        )}
      </div>
    </Panel>
  );
}
