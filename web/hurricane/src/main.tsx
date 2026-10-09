import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (window.location.hostname === "hurricane.codeblackwx.com") {
  window.location.replace(`https://tropics.codeblackwx.com${window.location.pathname}${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
}
