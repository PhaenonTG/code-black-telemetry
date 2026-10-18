import { useCoreOps } from "../core/useCoreOps"
import { VehicleWeather } from "../telemetry/VehicleWeather"

export default function VehicleTelemetry() {
  const { state, locationMode, referenceUnitId, chooseChaserLocation, chooseFallbackLocation } = useCoreOps()
  return <VehicleWeather units={state.fabric.units?.units ?? []}
    selectedId={locationMode === "chaser" ? referenceUnitId : ""}
    onSelect={id => id ? chooseChaserLocation(id) : chooseFallbackLocation()}
    receivedAt={state.fabric.unitsReceivedAt ?? null}
    connected={state.fabric.state === "LIVE" && !state.fabric.error}
    transportLabel={state.fabric.streamState === "open" ? "Shared authenticated Fabric live feed" : "Shared snapshot · existing 30-second fallback"} />
}
