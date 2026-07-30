import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { AtlasReconGlPage } from './map/AtlasReconGlPage.tsx'

const reconScreen = (import.meta.env.VITE_RECON_SCREEN as string | undefined)?.trim().toLowerCase()
const Root = reconScreen === "atlas-gl" ? AtlasReconGlPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

if ("serviceWorker" in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
