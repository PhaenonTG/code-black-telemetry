import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const App = lazy(() => import("./App"));
const ReportsPage = lazy(() => import("./ReportsPage"));

if (window.location.hostname === "hurricane.codeblackwx.com") {
  window.location.replace(`https://tropics.codeblackwx.com${window.location.pathname}${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById("root")!).render(<React.StrictMode><Suspense fallback={<div className="route-loading">Loading Tropics…</div>}>{window.location.pathname.startsWith("/reports") ? <ReportsPage /> : <App />}</Suspense></React.StrictMode>);
}
