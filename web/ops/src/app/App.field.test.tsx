import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import App from "./App"
vi.mock("react-router-dom", async importOriginal => {
  const router = await importOriginal<typeof import("react-router-dom")>()
  return { ...router, BrowserRouter: ({ children }: { children: ReactNode }) => <router.MemoryRouter initialEntries={["/field"]}>{children}</router.MemoryRouter> }
})
vi.mock("../auth/AuthProvider", () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth: vi.fn() }))
vi.mock("../components/AuthGate", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }))
vi.mock("../core/CoreOpsProvider", () => ({ CoreOpsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("../core/client", () => ({}))
vi.mock("../hooks/useViewport", () => ({ useViewport: () => "phone" }))
vi.mock("../hooks/useShellTheme", () => ({ useShellTheme: () => "dark" }))
vi.mock("../core/useSharedOpsStatus", () => ({ useSharedOpsStatus: () => ({ core: { state: "LIVE" }, fabric: { state: "LIVE" } }) }))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ state: { fabric: { units: null } }, referenceLabel: "Test location", locationMode: "fallback", referenceIsFallback: true, deviceLocation: { status: "unavailable" } }) }))
vi.mock("../pages/OpsWorkstation", () => ({ default: ({ focus }: { focus: string }) => <section data-map-focus={focus}>Field map surface</section> }))
afterEach(() => vi.unstubAllGlobals())
it("renders the Field map inside the phone shell at 390px without redirecting to Home", async () => {
  vi.stubGlobal("window", { innerWidth: 390 })
  renderToString(<App />)
  await vi.dynamicImportSettled()
  const html = renderToString(<App />)
  expect(html).toContain("shell--phone")
  expect(html).toContain('data-map-focus="FIELD INTELLIGENCE"')
  expect(html).toContain("Field map surface")
  expect(html).not.toContain("mobile-home")
})
