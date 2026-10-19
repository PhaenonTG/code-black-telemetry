import type { ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import AegisAlerts from "./AegisAlerts"
const mocks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, refresh: null as null | (() => void), replay: vi.fn(), cutoff: 85 }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect) } }))
vi.mock("../components/PageHeader", () => ({ PageHeader: ({ actions }: { actions: { props: { onClick: () => void } }; children?: ReactNode }) => { mocks.refresh = actions.props.onClick; return <h1>Aegis Alerts</h1> } }))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: {} }) }))
vi.mock("../../../../src/services/radar", () => ({ getRadarStatus: vi.fn().mockRejectedValue(new Error("offline")) }))
vi.mock("../../../../src/services/mapTiles", () => ({ hasMapboxToken: () => false }))
vi.mock("../core/aegisFeed", () => ({
  getAegisStatus: async () => ({ screen: { cutoff: mocks.cutoff } }),
  getAegisFeed: async () => ({ items: [] }), getAegisObservationPlan: async () => ({}),
  replayAegisPolicy: (...args: unknown[]) => mocks.replay(...args),
}))
afterEach(() => { mocks.effects = []; mocks.refresh = null; mocks.replay.mockReset(); mocks.cutoff = 85; vi.useRealTimers(); vi.unstubAllGlobals() })
it("mounts with one recorded replay, ignores the 30s/cutoff polls, and replays once per Refresh click", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", globalThis)
  mocks.replay.mockResolvedValue({ mode: "recorded", scans: [] })
  renderToString(<MemoryRouter><AegisAlerts /></MemoryRouter>)
  const cleanup = mocks.effects.map(effect => effect())
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.replay).toHaveBeenCalledTimes(1)
  mocks.cutoff = 90
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.replay).toHaveBeenCalledTimes(1)
  mocks.refresh?.(); await vi.advanceTimersByTimeAsync(0)
  expect(mocks.replay).toHaveBeenCalledTimes(2)
  mocks.refresh?.(); await vi.advanceTimersByTimeAsync(0)
  expect(mocks.replay).toHaveBeenCalledTimes(3)
  expect(mocks.replay.mock.calls[2][1].evidenceCutoff).toBe(90)
  cleanup.forEach(stop => stop?.())
})
