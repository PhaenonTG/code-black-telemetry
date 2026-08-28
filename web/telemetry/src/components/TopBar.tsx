import { useEffect, useState } from "react";
import type { StatusTelemetry } from "../telemetry/types";
import { timeLabel } from "../utils/format";

export function TopBar({ status }: { status: StatusTelemetry }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="top-bar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Code Black Telemetry</h1>
          <p>{status.vehicleName}</p>
        </div>
      </div>
      <div className="top-readouts">
        <span className="clock">{timeLabel(now)}</span>
        <span className="status-pill" data-state={status.connectionState}>{status.connectionState.toUpperCase()}</span>
        <span className="status-pill" data-health={status.overallHealth}>{status.overallHealth.toUpperCase()}</span>
      </div>
    </header>
  );
}
