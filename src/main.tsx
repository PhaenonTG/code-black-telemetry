import { lazy, StrictMode, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { SplashScreen } from './components/SplashScreen.tsx'

// Debug-only recon screen, opted into via a build-time env var — statically importing it here
// would drag mapbox-gl (and everything under src/map/) into the normal app's main chunk even
// though production builds never render it. Lazy so it only loads when actually selected.
const AtlasReconGlPage = lazy(() => import('./map/AtlasReconGlPage.tsx').then((mod) => ({ default: mod.AtlasReconGlPage })))

const reconScreen = (import.meta.env.VITE_RECON_SCREEN as string | undefined)?.trim().toLowerCase()
const Root = reconScreen === "atlas-gl" ? AtlasReconGlPage : App

const SPLASH_SEEN_KEY = "codeblack.splashSeenThisSession"

// Splash overlays the real app while it mounts underneath (not gating data fetch on it) —
// purely cosmetic cover for the native-splash-to-WebView handoff. Skipped for the recon screen,
// and skipped on a warm reload (sessionStorage survives a page refresh but not a fresh tab/process,
// so it only shows once per real cold start, not on every reload within the same session).
function RootWithSplash({ enableSplash }: { enableSplash: boolean }) {
  const [showSplash, setShowSplash] = useState(() => {
    if (!enableSplash) return false
    try {
      return sessionStorage.getItem(SPLASH_SEEN_KEY) !== "1"
    } catch {
      return true
    }
  })
  const complete = () => {
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "1")
    } catch {
      // Best-effort -- worst case the splash shows again next reload.
    }
    setShowSplash(false)
  }
  return (
    <>
      {showSplash && <SplashScreen onComplete={complete} />}
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootWithSplash enableSplash={reconScreen !== "atlas-gl"} />
    </ErrorBoundary>
  </StrictMode>,
)

if ("serviceWorker" in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
