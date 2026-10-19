import { useEffect, useState } from "react";
import "./Clock.css";

function formatNow(): { time: string; date: string } {
  const now = new Date();
  const tz = new Intl.DateTimeFormat([], { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  const time = `${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${tz}`.trim();
  const date = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return { time, date };
}

// Purely local wall-clock display -- never fed by Core, never subject to freshness/staleness. A
// stream needs a clock that keeps ticking even if the live data connection drops.
export function Clock() {
  const [now, setNow] = useState(formatNow);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(formatNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="rail-block rail-clock">
      <span className="rail-clock__time cb-mono">{now.time}</span>
      <span className="cb-label rail-clock__date">{now.date}</span>
    </section>
  );
}
