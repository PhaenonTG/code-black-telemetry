import { lazy, Suspense } from "react"
import { AegisPanel, CameraPanel, ChangesPanel, OfficialAlerts, TeamPanel } from "../desk/DeskPanels"
import { useDesk } from "../desk/DeskProvider"
const DeskMap = lazy(() => import("../desk/DeskMap").then((module) => ({ default: module.DeskMap })))

export default function ProducerDesk() {
  const { referenceLabel, refresh } = useDesk()
  return <div className="desk-workspace desk-producer"><div className="desk-workspace-heading"><div><span className="desk-eyebrow">Operations desk</span><h1>Producer</h1></div><span>{referenceLabel}</span><button onClick={refresh}>Refresh sources</button></div>
    <div className="desk-producer__grid"><div className="desk-producer__left"><div className="desk-producer__camera"><CameraPanel /></div><div className="desk-producer__map"><Suspense fallback={<p className="desk-empty">Loading map…</p>}><DeskMap /></Suspense></div></div><div className="desk-producer__right"><div className="desk-producer__team"><TeamPanel /></div><div className="desk-producer__alerts"><OfficialAlerts /></div><div className="desk-producer__ai"><AegisPanel /></div><div className="desk-producer__changes"><ChangesPanel /></div></div></div>
  </div>
}
