import { useCallback, useEffect, useState } from "react";
import { BrandBug } from "./components/BrandBug";
import { CommandRail } from "./components/CommandRail";
import { DevControlPanel } from "./components/DevControlPanel";
import { EventTakeover } from "./components/EventTakeover";
import { readOverlayConfig } from "./config/overlayConfig";
import type { OverlayConfig } from "./config/overlayConfig";
import { getOverlayProvider, useOverlayState } from "./stormIntel/store";
import "./styles/app.css";

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

function useStageFit() {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    function recompute() {
      const available = Math.min(window.innerWidth - 48, window.innerHeight - 48);
      const fitWidth = (window.innerWidth - 48) / STAGE_WIDTH;
      const fitHeight = (window.innerHeight - 48) / STAGE_HEIGHT;
      setFit(Math.max(0.2, Math.min(fitWidth, fitHeight, available > 0 ? 1 : 1)));
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);
  return fit;
}

export function App() {
  const state = useOverlayState();
  const provider = getOverlayProvider();
  const [config, setConfig] = useState<OverlayConfig>(() => readOverlayConfig());
  const fit = useStageFit();

  const handleConfigChange = useCallback((next: Partial<OverlayConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  const overlayStyle = {
    "--overlay-scale": config.scale,
    "--overlay-opacity": config.opacity,
  } as React.CSSProperties;

  return (
    <div className="dev-shell" style={{ "--stage-fit": fit } as React.CSSProperties}>
      <div className="stage-frame" data-bg={config.background}>
        <div className="overlay-root">
          <div className="overlay-scale" data-position={config.position} style={overlayStyle}>
            <BrandBug />
            <CommandRail state={state} />
          </div>
          <EventTakeover takeover={state.takeover} />
        </div>

        {config.devPanel && (
          <DevControlPanel
            state={state}
            config={config}
            onScenarioChange={(scenario) => provider.setScenario(scenario)}
            onContextChange={(contextType) => provider.setContextType(contextType)}
            onTakeover={(kind) => provider.triggerTakeover(kind)}
            onDismissTakeover={() => provider.dismissTakeover()}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>
    </div>
  );
}
