import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "../auth/AuthProvider"
import { AuthGate } from "../components/AuthGate"
import { AppShell } from "../layouts/AppShell"
import UpdatePassword from "../pages/UpdatePassword"
import OpsWorkstation from "../pages/OpsWorkstation"
import DevelopmentPage from "../pages/DevelopmentPage"
import Fleet from "../pages/Fleet"
import Operations from "../pages/Operations"
import Settings from "../pages/Settings"
import More from "../pages/More"

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
                <AppShell>
                  <Routes>
                    <Route path="/" element={<OpsWorkstation focus="LIVE OPS" />} />
                    <Route path="/radar" element={<OpsWorkstation focus="RADAR" />} />
                    <Route path="/storm-intel" element={<OpsWorkstation focus="STORM INTEL" />} />
                    <Route path="/models" element={<DevelopmentPage title="MODELS" />} />
                    <Route path="/soundings" element={<DevelopmentPage title="SOUNDINGS" detail="Vertical profile endpoint not yet available. Sounding Snapshot will enter here when Core exposes normalized profile data." />} />
                    <Route path="/consensus" element={<DevelopmentPage title="CONSENSUS" detail="Consensus architecture reserved. No ensemble agreement, target corridor, or percentage score is generated in Phase 1." />} />
                    <Route path="/targets" element={<DevelopmentPage title="TARGETS" detail="Target corridors are reserved for the future Consensus workflow. Phase 1 does not create automated chase targets." />} />
                    <Route path="/fleet" element={<Fleet />} />
                    <Route path="/stream" element={<DevelopmentPage title="STREAM" detail="Stream control integration is reserved. No producer controls or public stream switching are exposed in Phase 1." />} />
                    <Route path="/system" element={<Operations />} />
                    <Route path="/map" element={<OpsWorkstation focus="RADAR" />} />
                    <Route path="/weather" element={<OpsWorkstation focus="STORM INTEL" />} />
                    <Route path="/alerts" element={<OpsWorkstation focus="LIVE OPS" />} />
                    <Route path="/operations" element={<Operations />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/more" element={<More />} />
                  </Routes>
                </AppShell>
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
