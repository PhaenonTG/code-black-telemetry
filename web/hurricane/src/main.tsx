import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/latin-400.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";
import "./cockpit.css";

const App = lazy(() => import("./App"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const StormSystemPage = lazy(() => import("./StormSystemPage"));

if (window.location.hostname === "hurricane.codeblackwx.com") {
  window.location.replace(`https://tropics.codeblackwx.com${window.location.pathname}${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById("root")!).render(<React.StrictMode><Suspense fallback={<div className="route-loading">Loading Tropics…</div>}>{window.location.pathname.startsWith("/storms/") ? <StormSystemPage /> : window.location.pathname.startsWith("/reports") ? <ReportsPage /> : <App />}</Suspense></React.StrictMode>);
}
