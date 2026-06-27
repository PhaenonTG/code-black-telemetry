import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TopBar }    from "./components/layout/TopBar";
import { StatusStrip } from "./components/layout/StatusStrip";
import { BottomNav } from "./components/layout/BottomNav";
import { Dashboard } from "./pages/Dashboard";
import { Wind }      from "./pages/Wind";
import { Weather }   from "./pages/Weather";
import { GPS }       from "./pages/GPS";
import { System }    from "./pages/System";
import { Settings }  from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <StatusStrip />
      <Routes>
        <Route path="/"        element={<Dashboard />} />
        <Route path="/wind"    element={<Wind />} />
        <Route path="/weather" element={<Weather />} />
        <Route path="/gps"     element={<GPS />} />
        <Route path="/system"  element={<System />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  );
}
