import { Preferences } from "@capacitor/preferences";
import type { CanonicalLocation } from "./location";
import type { ExternalObservation } from "./situational";
import { resolveWeatherWithFallback, resolveWindWithFallback } from "./telemetry/fallback";
import { cardinalFromDeg, mbToInHg } from "./telemetry/quality";
import type { WeatherData, WindData } from "./telemetry/types";

export const VEHICLE_DISPLAY_PREF_KEY = "codeblack.vehicleDisplaySnapshot";

export interface VehicleDisplaySnapshot {
  updatedAt: number;
  locationName: string;
  locationSource: string;
  conditions: {
    tempF: number | null;
    dewpointF: number | null;
    humidity: number | null;
    pressureInHg: number | null;
    source: string;
  };
  wind: {
    speedMph: number | null;
    gustMph: number | null;
    directionDeg: number | null;
    directionCardinal: string;
    source: string;
  };
}

function nearestCityState(location: CanonicalLocation): string {
  if (location.resolvedCity && location.resolvedState) return `${location.resolvedCity}, ${location.resolvedState}`;
  if (location.resolvedCity) return location.resolvedCity;
  if (location.latitude != null && location.longitude != null) return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  return "Location unavailable";
}

export async function publishVehicleDisplaySnapshot({
  location,
  weather,
  wind,
  external,
}: {
  location: CanonicalLocation;
  weather: WeatherData | undefined;
  wind: WindData | undefined;
  external: ExternalObservation | null;
}) {
  const resolvedWeather = resolveWeatherWithFallback(weather, external);
  const resolvedWind = resolveWindWithFallback(wind, external);
  const pressureInHg = mbToInHg(resolvedWeather.pressure);
  const snapshot: VehicleDisplaySnapshot = {
    updatedAt: Date.now(),
    locationName: nearestCityState(location),
    locationSource: location.source,
    conditions: {
      tempF: resolvedWeather.temp,
      dewpointF: resolvedWeather.dew,
      humidity: resolvedWeather.humidity,
      pressureInHg,
      source: resolvedWeather.footerParts.length > 0 ? resolvedWeather.footerParts.join(" - ") : resolvedWeather.sourceLabel,
    },
    wind: {
      speedMph: resolvedWind.speed,
      gustMph: resolvedWind.gust,
      directionDeg: resolvedWind.direction,
      directionCardinal: cardinalFromDeg(resolvedWind.direction),
      source: resolvedWind.windSource,
    },
  };
  await Preferences.set({ key: VEHICLE_DISPLAY_PREF_KEY, value: JSON.stringify(snapshot) });
}
