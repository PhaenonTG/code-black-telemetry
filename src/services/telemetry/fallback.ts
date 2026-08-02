import type { ExternalObservation } from "../situational";
import { compactAge, freshness } from "./quality";
import type { WeatherData, WindData } from "./types";

function weatherTrustworthy(wx: WeatherData | undefined): boolean {
  if (!wx) return false;
  if (wx.source === "vehicle") return true;
  if (wx.source === "last-known") return freshness(wx.updatedAt) !== "OFFLINE";
  return false;
}

function windTrustworthy(wind: WindData | undefined): boolean {
  if (!wind) return false;
  if (wind.source === "vehicle") return true;
  if (wind.source === "last-known") return freshness(wind.updatedAt) !== "OFFLINE";
  return false;
}

export interface WeatherResolution {
  temp: number | null;
  dew: number | null;
  humidity: number | null;
  pressure: number | null;
  spread: number | null;
  usingExternal: boolean;
  obs: ExternalObservation | null;
  sourceLabel: string;
  badgeState: string;
  footerParts: string[];
}

// Primary (Pi) weather wins as long as it's live, or last-known and under 5 minutes old
// (matches the OFFLINE cutoff already used by freshness() everywhere else in the app).
// Otherwise fall through to the NWS station observation if one is available.
export function resolveWeatherWithFallback(wx: WeatherData | undefined, external: ExternalObservation | null): WeatherResolution {
  const trustworthy = weatherTrustworthy(wx);
  const obs = !trustworthy && external ? external : null;
  const temp = trustworthy ? wx?.tempF ?? null : obs?.tempF ?? wx?.tempF ?? null;
  const dew = trustworthy ? wx?.dewpointF ?? null : obs?.dewpointF ?? wx?.dewpointF ?? null;
  const humidity = trustworthy ? wx?.humidity ?? null : obs?.humidity ?? wx?.humidity ?? null;
  const pressure = trustworthy ? wx?.pressureMb ?? null : obs?.pressureMb ?? wx?.pressureMb ?? null;
  const spread = temp != null && dew != null ? temp - dew : null;
  const sourceLabel =
    wx?.source === "vehicle" ? "VEHICLE" : wx?.source === "last-known" ? "VEHICLE (LAST KNOWN)" : wx?.source === "simulator" ? "SIMULATOR - DEV" : wx?.sourceLabel ?? "UNAVAILABLE";
  const hasAge = Boolean(obs ? obs.updatedAt : wx?.updatedAt);
  const age = obs ? compactAge(obs.updatedAt) : compactAge(wx?.updatedAt);
  const footerParts = [
    obs ? obs.station : hasAge ? sourceLabel : null,
    obs && Number.isFinite(obs.distanceMi) ? `${obs.distanceMi.toFixed(0)} MI` : null,
    hasAge ? age : null,
  ].filter((part): part is string => Boolean(part));
  return {
    temp,
    dew,
    humidity,
    pressure,
    spread,
    usingExternal: Boolean(obs),
    obs,
    sourceLabel,
    badgeState: obs ? "fallback" : freshness(wx?.updatedAt),
    footerParts,
  };
}

export interface WindResolution {
  speed: number | null;
  gust: number | null;
  direction: number | null;
  usingExternal: boolean;
  windSource: string;
  identityText: string;
}

export function resolveWindWithFallback(wind: WindData | undefined, external: ExternalObservation | null): WindResolution {
  const trustworthy = windTrustworthy(wind);
  const useExternal = !trustworthy && external?.windSpeedMph != null;
  const speed = useExternal ? external?.windSpeedMph ?? null : wind?.speedMph ?? null;
  const gust = useExternal ? external?.windGustMph ?? null : wind?.gustMph ?? null;
  const direction = useExternal ? external?.windDirectionDeg ?? null : wind?.directionDeg ?? null;
  const identityText = speed === null
    ? "NO TRUSTED WIND"
    : useExternal
      ? `${external?.station} • ${external && Number.isFinite(external.distanceMi) ? `${external.distanceMi.toFixed(0)} MI` : "DISTANCE UNKNOWN"} • ${compactAge(external?.updatedAt)}`
      : compactAge(wind?.updatedAt);
  const windSource = useExternal
    ? "STATION WIND"
    : wind?.source === "vehicle"
      ? "VEHICLE WIND"
      : wind?.source === "last-known"
        ? "LAST VALID WIND"
        : "VEHICLE WIND OFFLINE";
  return { speed, gust, direction, usingExternal: useExternal, windSource, identityText };
}
