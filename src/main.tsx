import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Debug-only recon screen, opted into via a build-time env var — statically importing it here
// would drag mapbox-gl (and everything under src/map/) into the normal app's main chunk even
// though production builds never render it. Lazy so it only loads when actually selected.
const AtlasReconGlPage = lazy(() => import('./map/AtlasReconGlPage.tsx').then((mod) => ({ default: mod.AtlasReconGlPage })))

const reconScreen = (import.meta.env.VITE_RECON_SCREEN as string | undefined)?.trim().toLowerCase()
const Root = reconScreen === "atlas-gl" ? AtlasReconGlPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)

if ("serviceWorker" in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
