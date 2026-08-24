import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthGate } from "../components/AuthGate"
import { AppShell } from "../layouts/AppShell"
import Home from "../pages/Home"
import MapPage from "../pages/Map"
import Weather from "../pages/Weather"
import Alerts from "../pages/Alerts"
import Fleet from "../pages/Fleet"
import Operations from "../pages/Operations"
import Settings from "../pages/Settings"
import More from "../pages/More"

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthGate>
  )
}
