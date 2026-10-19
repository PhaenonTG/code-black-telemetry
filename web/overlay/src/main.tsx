import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Self-hosted via @fontsource/oswald (SIL OFL-1.1) -- no runtime Google Fonts CDN request.
// See web/overlay/THIRD_PARTY_NOTICES.md.
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/oswald/700.css";
import "./styles/theme.css";
import "./styles/brand.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
