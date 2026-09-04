import { SIMULATION_SCENARIOS } from "../stormIntel/types";
import type { ContextType, EventTakeoverKind, OverlayState, SimulationScenario } from "../stormIntel/types";
import type { OverlayConfig, PreviewBackground } from "../config/overlayConfig";
import "./DevControlPanel.css";

const CONTEXTS: ContextType[] = ["AT_UNIT", "AHEAD_OF_UNIT", "SELECTED_TARGET"];
const TAKEOVERS: EventTakeoverKind[] = [
  "TOR_WARNING",
  "SVR_WARNING",
  "MESO_DISCUSSION",
  "TOR_WATCH",
  "PDS_TOR_WATCH",
  "OBSERVED_TORNADO",
];

export function DevControlPanel({
  state,
  config,
  onScenarioChange,
  onContextChange,
  onTakeover,
  onDismissTakeover,
  onConfigChange,
}: {
  state: OverlayState;
  config: OverlayConfig;
  onScenarioChange: (scenario: SimulationScenario) => void;
  onContextChange: (contextType: ContextType) => void;
  onTakeover: (kind: EventTakeoverKind) => void;
  onDismissTakeover: () => void;
  onConfigChange: (next: Partial<OverlayConfig>) => void;
}) {
  return (
    <div className="dev-panel">
      <div className="dev-panel__title">DEV CONTROLS -- not part of the broadcast overlay</div>

      <div className="dev-panel__row">
        <span>Scenario</span>
        <select value={state.scenario} onChange={(e) => onScenarioChange(e.target.value as SimulationScenario)}>
          {SIMULATION_SCENARIOS.map((scenario) => (
            <option key={scenario} value={scenario}>
              {scenario}
            </option>
          ))}
        </select>
      </div>

      <div className="dev-panel__row">
        <span>Context</span>
        <select value={state.contextType} onChange={(e) => onContextChange(e.target.value as ContextType)}>
          {CONTEXTS.map((ctx) => (
            <option key={ctx} value={ctx}>
              {ctx}
            </option>
          ))}
        </select>
      </div>

      <div className="dev-panel__row">
        <span>Background</span>
        <select
          value={config.background}
          onChange={(e) => onConfigChange({ background: e.target.value as PreviewBackground })}
        >
          <option value="storm">storm (dev)</option>
          <option value="road">road (dev)</option>
          <option value="transparent">transparent (OBS-real)</option>
        </select>
      </div>

      <div className="dev-panel__row">
        <span>Scale {config.scale.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={config.scale}
          onChange={(e) => onConfigChange({ scale: Number(e.target.value) })}
        />
      </div>

      <div className="dev-panel__row">
        <span>Opacity {config.opacity.toFixed(2)}</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={config.opacity}
          onChange={(e) => onConfigChange({ opacity: Number(e.target.value) })}
        />
      </div>

      <div className="dev-panel__row">
        <span>Position</span>
        <select value={config.position} onChange={(e) => onConfigChange({ position: e.target.value as OverlayConfig["position"] })}>
          <option value="bottom">bottom</option>
          <option value="top">top</option>
        </select>
      </div>

      <div className="dev-panel__section">Event takeover</div>
      <div className="dev-panel__takeovers">
        {TAKEOVERS.map((kind) => (
          <button key={kind} onClick={() => onTakeover(kind)}>
            {kind.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      {state.takeover && (
        <button className="dev-panel__dismiss" onClick={onDismissTakeover}>
          Dismiss takeover
        </button>
      )}
    </div>
  );
}
