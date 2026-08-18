import type { ClockMode } from "./settings";

const CENTRAL_TIME_ZONE = "America/Chicago";

function partsFor(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    zone: get("timeZoneName").replace(/^GMT-?0?$/, "UTC"),
  };
}

export function formatOpsClock(date: Date, mode: ClockMode) {
  if (mode === "zulu") {
    return { time: partsFor(date, "UTC").time, label: "Zulu", zone: "UTC" };
  }
  if (mode === "central") {
    const central = partsFor(date, CENTRAL_TIME_ZONE);
    return { time: central.time, label: "Central", zone: central.zone };
  }
  const local = partsFor(date);
  return { time: local.time, label: "Local", zone: local.zone };
}
