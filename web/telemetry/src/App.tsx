import { BottomNav } from "./components/BottomNav";
import { Dashboard } from "./components/Dashboard";
import { TopBar } from "./components/TopBar";
import { useTelemetrySnapshot } from "./telemetry/store";

export function App() {
  const snapshot = useTelemetrySnapshot();

  return (
    <div className="app">
      <TopBar status={snapshot.status} />
      <Dashboard snapshot={snapshot} />
      <BottomNav />
    </div>
  );
}
