import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import { RouteLoading, WorkspaceSkeleton } from "../components/WorkspaceSkeleton"
import { loadChaseWorkspace, loadAnalysisWorkspace, prefetchLinkedWorkspace, prefetchWorkspaceRoute } from "./workspaceChunks"
vi.mock("../pages/ChaseWorkspace", () => ({ default: () => null }))
vi.mock("../pages/AnalysisWorkspace", () => ({ default: () => null }))
afterEach(() => vi.unstubAllGlobals())
it("shares prefetched workspace promises with lazy route loading", async () => {
  expect(prefetchWorkspaceRoute("/weather")).toBeUndefined()
  expect(prefetchWorkspaceRoute("/chase-desk-other")).toBeUndefined()
  const chase = loadChaseWorkspace()
  await prefetchWorkspaceRoute("/chase-desk?source=nav")
  expect(loadChaseWorkspace()).toBe(chase)
  const analysis = loadAnalysisWorkspace()
  await prefetchWorkspaceRoute("/setup-review/outlook")
  expect(loadAnalysisWorkspace()).toBe(analysis)
  await expect(chase).resolves.toHaveProperty("default")
})
it("finds the link when navigation intent comes from a nested icon or label", async () => {
  class Target {
    closest(selector: string) { expect(selector).toBe("a[href]"); return { getAttribute: () => "/chase-desk" } }
  }
  vi.stubGlobal("Element", Target)
  await expect(prefetchLinkedWorkspace({ target: new Target() as unknown as EventTarget })).resolves.toHaveProperty("default")
  expect(prefetchLinkedWorkspace({ target: null })).toBeUndefined()
  const shell = readFileSync(new URL("../layouts/AppShell.tsx", import.meta.url), "utf8")
  for (const event of ["onMouseOver", "onFocus", "onTouchStart"]) {
    expect(shell.split(`${event}={prefetchLinkedWorkspace}`)).toHaveLength(3)
  }
})
it.each(["/chase-desk", "/setup-review/outlook", "/setup-review/potential"])("shows a stable chase skeleton at %s", path => {
  const html = renderToString(<MemoryRouter initialEntries={[path]}><RouteLoading /></MemoryRouter>)
  expect(html).toContain('class="workspace-skeleton"')
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-hidden="true"')
  expect(html).not.toContain("Loading\u2026")
})
it("keeps the steel/red design and disables shimmer for reduced motion", () => {
  expect(renderToString(<WorkspaceSkeleton title="Opening Outlook" />)).toContain('aria-label="Opening Outlook"')
  const css = readFileSync(new URL("../components/WorkspaceSkeleton.css", import.meta.url), "utf8")
  expect(css).toContain("Anton")
  expect(css).toContain("--cb-steel")
  expect(css).toContain("--cb-red")
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/)
})

it("uses the route-aware skeleton at the app suspense boundary", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
  expect(app).toContain('<Suspense fallback={<RouteLoading />}>')
})
