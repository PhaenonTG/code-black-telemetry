import { lazy, Suspense, useEffect, useState } from "react"
import { AegisPanel, CameraPanel, CellPanel, ChangesPanel, OfficialAlerts, TargetPanel, UnitStrip } from "../desk/DeskPanels"
const DeskMap = lazy(() => import("../desk/DeskMap").then((module) => ({ default: module.DeskMap })))
export default function ChaseDesk() {
  const [screen, setScreen] = useState("situation")
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 900px)").matches)
  useEffect(() => { const query = matchMedia("(max-width: 900px)"); const change = () => setNarrow(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change) }, [])
  return <div className="desk-workspace desk-chase"><UnitStrip /><OfficialAlerts compact />
    <div className="desk-map-tabs" role="group" aria-label="Field map"><button aria-pressed={screen === "situation"} onClick={() => setScreen("situation")}>Situation</button><button aria-pressed={screen === "radar"} onClick={() => setScreen("radar")}>Radar</button></div>
    <div className={`desk-chase__maps desk-chase__maps--${screen}`}><div className="desk-chase__situation"><Suspense fallback={<p className="desk-empty">Loading situation…</p>}><DeskMap active={!narrow || screen === "situation"} /></Suspense></div><div className="desk-chase__radar"><Suspense fallback={<p className="desk-empty">Loading radar…</p>}><DeskMap radar active={!narrow || screen === "radar"} receiveEvents={narrow} /></Suspense></div></div>
    <div className="desk-chase__rail"><div className="desk-panel-stack"><TargetPanel /><CellPanel /></div><AegisPanel scope="point" /><ChangesPanel /></div><CameraPanel small />
  </div>
}
