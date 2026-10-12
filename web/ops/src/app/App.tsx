import { Suspense, lazy } from "react"
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom"
import { AuthProvider } from "../auth/AuthProvider"
import { AuthGate } from "../components/AuthGate"
import { CoreOpsProvider } from "../core/CoreOpsProvider"
import { AppShell } from "../layouts/AppShell"
import UpdatePassword from "../pages/UpdatePassword"

// Route-level code splitting -- this bundle shipped as a single ~3MB JS chunk with everything
// (including the map/mapbox-gl stack, only needed by two of these routes) loaded on first paint,
// even for someone who only ever opens Settings. Each page now loads on first visit instead.
const OpsWorkstation = lazy(() => import("../pages/OpsWorkstation"))
const StormIntelWorkspace = lazy(() => import("../pages/StormIntelWorkspace"))
const DevelopmentPage = lazy(() => import("../pages/DevelopmentPage"))
const Fleet = lazy(() => import("../pages/Fleet"))
const Operations = lazy(() => import("../pages/Operations"))
const Settings = lazy(() => import("../pages/Settings"))
const More = lazy(() => import("../pages/More"))
const Stream = lazy(() => import("../pages/Stream"))
const ChaseTargets = lazy(() => import("../pages/ChaseTargets"))
const AegisObservation = lazy(() => import("../pages/AegisObservation"))
const Diagnostics = lazy(() => import("../pages/Diagnostics"))
const ProducerDesk = lazy(() => import("../pages/ProducerDesk"))
const ChaseDesk = lazy(() => import("../pages/ChaseDesk"))
const AnalysisDesk = lazy(() => import("../pages/AnalysisDesk"))
import { useDesk } from "../desk/DeskProvider"

function WorkspaceLanding() {
  const { preferences } = useDesk()
  return <Navigate to={`/${preferences.workspace}`} replace />
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
                    <Suspense fallback={<div className="page-empty">Loading…</div>}>
                      <Routes>
                        <Route path="/" element={<WorkspaceLanding />} />
                        <Route path="/producer" element={<ProducerDesk />} />
                        <Route path="/chase" element={<ChaseDesk />} />
                        <Route path="/analysis" element={<AnalysisDesk />} />
                        <Route path="/map" element={<OpsWorkstation focus="OPERATIONS MAP" />} />
                        <Route path="/radar" element={<OpsWorkstation focus="RADAR LAB" />} />
                        <Route path="/weather" element={<StormIntelWorkspace />} />
                        <Route path="/field" element={<OpsWorkstation focus="FIELD INTELLIGENCE" />} />
                        <Route path="/storm-intel" element={<Navigate to="/weather" replace />} />
                        <Route path="/models" element={<DevelopmentPage title="MODELS" />} />
                        <Route path="/soundings" element={<DevelopmentPage title="SOUNDINGS" detail="Vertical profile endpoint not yet available. Sounding Snapshot will enter here when Core exposes normalized profile data." />} />
                        <Route path="/consensus" element={<DevelopmentPage title="CONSENSUS" detail="Consensus architecture reserved. No ensemble agreement, target corridor, or percentage score is generated in Phase 2." />} />
                        <Route path="/targets" element={<ChaseTargets />} />
                        <Route path="/aegis" element={<AegisObservation />} />
                        <Route path="/diagnostics" element={<Diagnostics />} />
                        <Route path="/fleet" element={<Fleet />} />
                        <Route path="/stream" element={<Stream />} />
                        <Route path="/system" element={<Operations />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/more" element={<More />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
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
