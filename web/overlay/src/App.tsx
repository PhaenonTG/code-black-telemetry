import { useCallback, useEffect, useState } from "react";
import { BrandBug } from "./components/BrandBug";
import { CommandRail } from "./components/CommandRail";
import { DevControlPanel } from "./components/DevControlPanel";
import { EventTakeover } from "./components/EventTakeover";
import { readOverlayConfig } from "./config/overlayConfig";
import type { OverlayConfig } from "./config/overlayConfig";
import { getOverlayMode, getOverlayProvider, useOverlayState } from "./stormIntel/store";
import "./styles/app.css";

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

// Fixed 1920x1080 design canvas, uniformly scaled to fill the real OBS browser-source canvas
// (any resolution -- 1080p/1440p/4K) so the broadcast composition never reflows, only scales.
// Dev preview reserves a small breathing-room margin so the stage doesn't touch the window edge;
// production (dev=0) fills the entire available canvas exactly, scaling up when it's larger than
// 1920x1080 -- this used to be capped at 1.0 by a dead `available > 0 ? 1 : 1` condition, which
// meant the overlay never grew past 1080p and left an opaque dev-shell border at 1440p/4K.
function useStageFit(hasPreviewPadding: boolean) {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    function recompute() {
      const pad = hasPreviewPadding ? 48 : 0;
      const fitWidth = (window.innerWidth - pad) / STAGE_WIDTH;
      const fitHeight = (window.innerHeight - pad) / STAGE_HEIGHT;
      setFit(Math.max(0.2, Math.min(fitWidth, fitHeight)));
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [hasPreviewPadding]);
  return fit;
}

export function App() {
  const state = useOverlayState();
  const provider = getOverlayProvider();
  const [config, setConfig] = useState<OverlayConfig>(() => readOverlayConfig());
  const fit = useStageFit(config.devPanel);

  const handleConfigChange = useCallback((next: Partial<OverlayConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  const overlayStyle = {
    "--overlay-scale": config.scale,
    "--overlay-opacity": config.opacity,
  } as React.CSSProperties;

  return (
    <div
      className="dev-shell"
      data-preview={config.devPanel ? "" : undefined}
      style={{ "--stage-fit": fit } as React.CSSProperties}
    >
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
            mode={getOverlayMode()}
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
