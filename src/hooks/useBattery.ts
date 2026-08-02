import { useEffect, useState } from "react";
import { Device } from "@capacitor/device";

const POLL_MS = 30_000;

export function useBattery() {
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const info = await Device.getBatteryInfo();
        if (!cancelled && info.batteryLevel != null) {
          setLevel(Math.round(info.batteryLevel * 100));
        }
      } catch {
        // Battery info unavailable in this environment (e.g. web preview without the Battery API).
      }
    };
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return level;
}
