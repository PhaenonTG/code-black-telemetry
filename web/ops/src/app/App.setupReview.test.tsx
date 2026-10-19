import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import App from "./App"
const state = vi.hoisted(() => ({ path: "/analysis" }))
vi.mock("react-router-dom", async importOriginal => {
  const router = await importOriginal<typeof import("react-router-dom")>()
  return { ...router,
    BrowserRouter: ({ children }: { children: ReactNode }) => <router.MemoryRouter initialEntries={[state.path]}>{children}</router.MemoryRouter>,
    Navigate: ({ to }: { to: string }) => <a data-redirect="true" href={to}>Redirect</a>,
  }
})
vi.mock("../auth/AuthProvider", () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth: vi.fn() }))
vi.mock("../components/AuthGate", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }))
vi.mock("../core/CoreOpsProvider", () => ({ CoreOpsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("../layouts/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock("../core/client", () => ({ fetchForecast: vi.fn() }))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: {} }) }))
afterEach(() => vi.unstubAllGlobals())

it.each([
  ["/analysis", "/setup-review"],
  ["/analysis?mode=today&x=1", "/setup-review/today?mode=today&amp;x=1"],
  ...["today", "outlook", "potential", "drafts", "briefings", "surveillance"].map(tab => [`/analysis/${tab}?x=1`, `/setup-review/${tab}?x=1`]),
  ["/analysis/horizons", "/setup-review/outlook"],
  ["/analysis/drafts/setup-20261019-0123456789?revision=2&x=1", "/setup-review/drafts/setup-20261019-0123456789?revision=2&amp;x=1"],
  ["/analysis/briefings/setup-20261019-0123456789?revision=3&x=1", "/setup-review/briefings/setup-20261019-0123456789?revision=3&amp;x=1"],
  ["/analysis/setup/setup-20261019-0123456789?revision=4", "/setup-review/drafts/setup-20261019-0123456789?revision=4"],
  ["/chase-setups?x=1", "/setup-review/drafts?x=1"],
  ["/chase-setups/setup-20261019-0123456789?revision=4&x=1", "/setup-review/drafts/setup-20261019-0123456789?revision=4&amp;x=1"],
])("routes %s straight to %s in one hop", (path, destination) => {
  state.path = path
  const html = renderToString(<App />)
  expect(html).toContain(`href="${destination}"`)
  expect(html.match(/data-redirect="true"/g)).toHaveLength(1)
})
