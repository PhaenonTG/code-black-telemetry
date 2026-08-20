import { useEffect, useState } from "react";
import { loadPiEndpoint, savePiEndpoint, subscribePiEndpoint } from "../../services/settings";

type TestState = "idle" | "testing" | "ok" | "failed";

export function PiEndpointPanel() {
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [message, setMessage] = useState("Configure LAN, hostname, or Tailscale endpoint.");

  const normalizeEndpoint = (value: string) => {
    const target = value.trim().replace(/\/$/, "");
    if (!target) return "";
    return /^https?:\/\//i.test(target) ? target : `http://${target}`;
  };

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
    const normalized = await savePiEndpoint(normalizeEndpoint(endpoint));
    setEndpoint(normalized);
    setSaved(normalized);
    setTestState("idle");
    setMessage(normalized ? "Endpoint saved. Reconnect will happen automatically." : "Endpoint cleared. Running standalone until configured.");
  };

  const test = async () => {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) {
      setTestState("failed");
      setMessage("Enter a Pi endpoint first.");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    setTestState("testing");
    try {
      const response = await fetch(`${normalized}/health`, { signal: controller.signal, cache: "no-store" });
      setTestState(response.ok ? "ok" : "failed");
      setMessage(response.ok ? `Health check OK at ${normalized}` : `Health check returned HTTP ${response.status}`);
    } catch {
      setTestState("failed");
      setMessage(`No /health response from ${normalized}`);
    } finally {
      window.clearTimeout(timer);
    }
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
