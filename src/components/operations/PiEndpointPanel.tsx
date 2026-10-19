import { useEffect, useRef, useState } from "react";
import { testHttpConnection } from "../../services/connection";
import { loadPiEndpoint, normalizeEndpointInput, savePiEndpoint, subscribePiEndpoint } from "../../services/settings";

type TestState = "idle" | "testing" | "ok" | "warn" | "failed";

export function PiEndpointPanel() {
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [message, setMessage] = useState("Configure LAN, hostname, or Tailscale endpoint.");
  const testRunRef = useRef(0);

  useEffect(() => {
    void loadPiEndpoint();
    const unsubscribe = subscribePiEndpoint((value) => {
      setEndpoint(value);
      setSaved(value);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const persist = async () => {
    try {
      const normalized = await savePiEndpoint(endpoint);
      setEndpoint(normalized);
      setSaved(normalized);
      setTestState("idle");
      setMessage(normalized ? "Endpoint saved. Reconnect will happen automatically." : "Endpoint cleared. Running standalone until configured.");
    } catch (error) {
      setTestState("failed");
      setMessage(error instanceof Error ? error.message : "Endpoint is not valid.");
    }
  };

  const test = async () => {
    const normalized = normalizeEndpointInput(endpoint);
    if (!normalized.ok) {
      setTestState("failed");
      setMessage(normalized.errorSummary ?? "Endpoint is not valid.");
      return;
    }
    if (!normalized.endpoint) {
      setTestState("failed");
      setMessage("Enter a Pi endpoint first.");
      return;
    }
    const runId = ++testRunRef.current;
    setTestState("testing");
    setMessage(`Testing ${normalized.endpoint}...`);
    const result = await testHttpConnection(normalized.endpoint);
    if (runId !== testRunRef.current) return;
    const state = result.status.connectionState;
    setTestState(state === "CONNECTED" ? "ok" : state === "DEGRADED" ? "warn" : "failed");
    setMessage(state === "CONNECTED" ? `${result.message} ${normalized.endpoint}` : `${normalized.endpoint}: ${result.message}`);
  };

  return (
    <section className="cb-panel pi-endpoint-panel">
      <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />Pi Endpoint</div>
      <div className="endpoint-form">
        <label>
          <span>API base</span>
          <input
            value={endpoint}
            onChange={(event) => {
              setEndpoint(event.target.value);
              testRunRef.current += 1;
              setTestState("idle");
              setMessage("Endpoint changed. Save or test before relying on it.");
            }}
            placeholder="http://192.168.0.209:5000 or http://raspberrypi.local:5000"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <div className="endpoint-actions">
          <button onClick={persist} disabled={endpoint === saved}>Save</button>
          <button onClick={test} disabled={testState === "testing"}>Test</button>
        </div>
        <div className={`endpoint-state endpoint-state--${testState}`}>{message}</div>
        <div className="endpoint-presets">
          {["http://192.168.0.209:5000", "http://raspberrypi.local:5000", "http://100.80.136.32:5000"].map((preset) => (
            <button key={preset} onClick={() => setEndpoint(preset)}>{preset.replace("http://", "")}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
