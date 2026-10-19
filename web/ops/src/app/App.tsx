import { Suspense, lazy } from "react"
import { BrowserRouter, Navigate, Routes, Route, useLocation, useParams } from "react-router-dom"
import { AuthProvider } from "../auth/AuthProvider"
import { AuthGate } from "../components/AuthGate"
import { CoreOpsProvider } from "../core/CoreOpsProvider"
import { AppShell } from "../layouts/AppShell"
import UpdatePassword from "../pages/UpdatePassword"
import { RouteLoadBoundary } from "./RouteLoadBoundary"

// Route-level code splitting -- this bundle shipped as a single ~3MB JS chunk with everything
// (including the map/mapbox-gl stack, only needed by two of these routes) loaded on first paint,
// even for someone who only ever opens Settings. Each page now loads on first visit instead.
const OpsWorkstation = lazy(() => import("../pages/OpsWorkstation"))
const StormIntelWorkspace = lazy(() => import("../pages/StormIntelWorkspace"))
const SoundingsWorkspace = lazy(() => import("../pages/SoundingsWorkspace"))
const DevelopmentPage = lazy(() => import("../pages/DevelopmentPage"))
const Fleet = lazy(() => import("../pages/Fleet"))
const Operations = lazy(() => import("../pages/Operations"))
const StatusCenter = lazy(() => import("../pages/StatusCenter"))
const Settings = lazy(() => import("../pages/Settings"))
const More = lazy(() => import("../pages/More"))
const Stream = lazy(() => import("../pages/Stream"))
const AiHandoff = lazy(() => import("../pages/AiHandoff"))
const MobileHome = lazy(() => import("../pages/MobileHome"))
const HurricaneWatch = lazy(() => import("../pages/HurricaneWatch"))
const AegisAlerts = lazy(() => import("../pages/AegisAlerts"))
const AutomationLab = lazy(() => import("../pages/AutomationLab"))
const ProducerWorkspace = lazy(() => import("../pages/ProducerWorkspace"))
const ChaseWorkspace = lazy(() => import("../pages/ChaseWorkspace"))
const AnalysisWorkspace = lazy(() => import("../pages/AnalysisWorkspace"))

function LegacyChaseSetupRedirect() {
  const { setupId } = useParams()
  const location = useLocation()
  const destination = setupId ? `/analysis/drafts/${setupId}${location.search}` : `/analysis/drafts${location.search}`
  return <Navigate to={destination} replace />
}

// /update-password is reachable regardless of auth state -- it's the landing page for a
// Supabase password-recovery email link, which itself establishes a temporary session (see
// UpdatePassword.tsx). Every other route is gated behind AuthGate: no protected page renders
// until the Supabase session + profiles authorization check resolves.
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route
            path="/*"
            element={
              <AuthGate>
                <CoreOpsProvider>
                  <AppShell>
                    <RouteLoadBoundary><Suspense fallback={<div className="page-empty">Loading…</div>}>
                      <Routes>
                        <Route path="/" element={<MobileHome />} />
                        <Route path="/producer" element={<ProducerWorkspace />} />
                        <Route path="/workspace/chase" element={<ChaseWorkspace />} />
                        <Route path="/analysis" element={<AnalysisWorkspace />} />
                        <Route path="/analysis/drafts" element={<AnalysisWorkspace />} />
                        <Route path="/analysis/drafts/:setupId" element={<AnalysisWorkspace />} />
                        <Route path="/analysis/briefings" element={<AnalysisWorkspace />} />
                        <Route path="/analysis/briefings/:setupId" element={<AnalysisWorkspace />} />
                        <Route path="/analysis/setup/:setupId" element={<LegacyChaseSetupRedirect />} />
                        <Route path="/radar" element={<OpsWorkstation focus="RADAR LAB" />} />
                        <Route path="/weather" element={<StormIntelWorkspace />} />
                        <Route path="/hurricane" element={<HurricaneWatch />} />
                        <Route path="/chase-setups" element={<LegacyChaseSetupRedirect />} />
                        <Route path="/chase-setups/:setupId" element={<LegacyChaseSetupRedirect />} />
                        <Route path="/aegis-alerts" element={<AegisAlerts />} />
                        {/* Keep the short and earlier observation-plan URLs valid. */}
                        <Route path="/aegis" element={<Navigate to="/aegis-alerts" replace />} />
                        <Route path="/aegis-observation" element={<Navigate to="/aegis-alerts" replace />} />
                        <Route path="/automation-lab" element={<AutomationLab />} />
                        <Route path="/field" element={<OpsWorkstation focus="FIELD INTELLIGENCE" />} />
                        <Route path="/storm-intel" element={<Navigate to="/weather" replace />} />
                        <Route path="/models" element={<DevelopmentPage title="MODELS" />} />
                        <Route path="/soundings" element={<SoundingsWorkspace />} />
                        <Route path="/consensus" element={<DevelopmentPage title="CONSENSUS" detail="Consensus architecture reserved. No ensemble agreement, target corridor, or percentage score is generated in Phase 2." />} />
                        <Route path="/targets" element={<DevelopmentPage title="TARGETS" detail="Target corridors are reserved for the future Consensus workflow. Phase 2 does not create automated chase targets." />} />
                        <Route path="/chase" element={<Fleet />} />
                        <Route path="/fleet" element={<Navigate to="/chase" replace />} />
                        <Route path="/stream" element={<Stream />} />
                        <Route path="/ai" element={<AiHandoff />} />
                        <Route path="/system" element={<Operations />} />
                        <Route path="/status-center" element={<StatusCenter />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/more" element={<More />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense></RouteLoadBoundary>
                  </AppShell>
                </CoreOpsProvider>
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
