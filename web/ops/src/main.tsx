import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/index.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './styles/desk.css'
import { readOpsCoreConfig } from './core/config'
import { installBrowserDiagnostics } from './diagnostics'

// Captures only unhandled browser failures as small, redacted incident records. Normal
// requests and browser activity are deliberately not uploaded.
installBrowserDiagnostics(readOpsCoreConfig())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
