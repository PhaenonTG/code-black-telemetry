import { DashCard } from "../components/ui/DashCard";

export function Settings() {
  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr", alignContent: "start" }}>
      <DashCard title="Data Source">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-cb-secondary uppercase tracking-wide">Mode</span>
            <span className="font-mono text-xs text-cb-amber">DEVELOPMENT</span>
          </div>
          <p className="text-[11px] text-cb-muted leading-5">
            Running on simulated telemetry. To connect to the Raspberry Pi, update
            <code className="mx-1 text-cb-blue">src/services/telemetry/index.ts</code>
            and replace <code className="text-cb-blue">SimulatorProvider</code> with your API or WebSocket provider.
          </p>
        </div>
      </DashCard>

      <DashCard title="Vehicle">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-cb-secondary uppercase tracking-wide">Unit ID</span>
            <span className="font-mono text-xs text-white">UNIT-01</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-cb-secondary uppercase tracking-wide">Version</span>
            <span className="font-mono text-xs text-white">Phase 1.0.0</span>
          </div>
        </div>
      </DashCard>

      <DashCard title="Display" className="col-span-2">
        <p className="text-[11px] text-cb-muted">
          Display settings will be configurable in a future phase. Optimized for landscape 1280×800 tablet.
        </p>
      </DashCard>
    </div>
  );
}
