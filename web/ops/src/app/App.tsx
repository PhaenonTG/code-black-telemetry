import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "../auth/AuthProvider"
import { AuthGate } from "../components/AuthGate"
import { AppShell } from "../layouts/AppShell"
import UpdatePassword from "../pages/UpdatePassword"
import Home from "../pages/Home"
import MapPage from "../pages/Map"
import Weather from "../pages/Weather"
import Alerts from "../pages/Alerts"
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
                    <Route path="/" element={<Home />} />
                    <Route path="/map" element={<MapPage />} />
                    <Route path="/weather" element={<Weather />} />
                    <Route path="/alerts" element={<Alerts />} />
                    <Route path="/fleet" element={<Fleet />} />
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
