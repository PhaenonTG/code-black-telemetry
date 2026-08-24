import { useEffect, useState } from "react"
import { AtlasMap } from "../../../../src/map/AtlasMap"
import { browserLocationAdapter, type LocationState } from "../adapters"
import type { AtlasGpsPoint } from "../../../../src/map/types"
import type { TrafficCamera, RoadConditionEvent } from "../../../../src/services/mapLayerModels"
import type { AlertProduct } from "../../../../src/services/situational"
import { MapCameraViewer } from "../components/MapCameraViewer"
import { MapSituationPanel } from "../components/MapSituationPanel"

function toAtlasGps(s: LocationState): AtlasGpsPoint | null {
  if (s.status !== "ready") return null
  return { lat:s.lat, lon:s.lon, accuracyM:s.accuracyM, headingDeg:s.headingDeg, speedMph:s.speedMph }
}
function gpsStatusLine(s: LocationState) {
  return s.status==="ready" ? `GPS LIVE · ±${Math.round(s.accuracyM)}m` : s.status==="requesting" ? "GPS CHECKING" : s.status==="denied" ? "GPS DENIED" : "GPS UNAVAILABLE"
}
type Selection = { kind:"alert"; alert:AlertProduct } | { kind:"road"; road:RoadConditionEvent }

export default function MapPage() {
  const [gps,setGps]=useState<LocationState>({status:"requesting"})
  const [camera,setCamera]=useState<TrafficCamera|null>(null)
  const [selection,setSelection]=useState<Selection|null>(null)
  useEffect(()=>{let cancelled=false; void browserLocationAdapter.getCurrent().then(s=>{if(!cancelled)setGps(s)}); const unwatch=browserLocationAdapter.watch(s=>{if(!cancelled)setGps(s)}); return()=>{cancelled=true;unwatch()}},[])
  useEffect(()=>{
    const cam=(e:Event)=>{const v=(e as CustomEvent<TrafficCamera>).detail;if(v?.id){setSelection(null);setCamera(v)}}
    const road=(e:Event)=>{const v=(e as CustomEvent<RoadConditionEvent>).detail;if(v?.id){setCamera(null);setSelection({kind:"road",road:v})}}
    const alert=(e:Event)=>{const v=(e as CustomEvent<AlertProduct>).detail;if(v?.id){setCamera(null);setSelection({kind:"alert",alert:v})}}
    window.addEventListener("codeblack:map-camera-open",cam); window.addEventListener("codeblack:map-road-open",road); window.addEventListener("codeblack:map-alert-open",alert)
    return()=>{window.removeEventListener("codeblack:map-camera-open",cam);window.removeEventListener("codeblack:map-road-open",road);window.removeEventListener("codeblack:map-alert-open",alert)}
  },[])
  return <div className="page-map"><AtlasMap gps={toAtlasGps(gps)} rangeRings="off" statusLines={[gpsStatusLine(gps)]} controlsVariant="full"/>{camera&&<MapCameraViewer camera={camera} onClose={()=>setCamera(null)}/>} {selection&&<MapSituationPanel selection={selection} onClose={()=>setSelection(null)}/>}</div>
}
