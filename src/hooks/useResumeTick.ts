import { useEffect, useState } from "react";

// App.tsx dispatches "codeblack:resume" when Capacitor reports the app coming back to the
// foreground (e.g. tablet screen was off, app was backgrounded). Polling hooks that only refresh
// on their own interval can otherwise sit on stale data for up to their full interval after a long
// background stretch -- bumping this into an effect's dependency array forces an immediate refetch
// the moment the driver is looking at the screen again, instead of waiting out the schedule.
export function useResumeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick((n) => n + 1);
    window.addEventListener("codeblack:resume", handler);
    return () => window.removeEventListener("codeblack:resume", handler);
  }, []);
  return tick;
}
