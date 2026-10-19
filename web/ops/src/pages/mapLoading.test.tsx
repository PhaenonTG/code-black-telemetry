import { readFileSync } from "node:fs"
import { afterEach, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"
import { HurricaneMap } from "./HurricaneWatch"
const mocks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, refs: [] as Array<{ current: unknown }>, create: vi.fn(), remove: vi.fn() }))
vi.mock("react", async original => {
  const react = await original<typeof import("react")>()
  return { ...react, useRef: (value: unknown) => { const ref = react.useRef(value); mocks.refs.push(ref); return ref }, useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect) }
})
vi.mock("../../../../src/services/mapTiles", () => ({ mapboxAccessToken: () => "test-token" }))
vi.mock("../../../../src/map/AtlasMosaicLayer", () => ({ startAtlasMosaicLayer: vi.fn() }))
vi.mock("mapbox-gl", () => ({ default: { Map: class {
  constructor() { mocks.create() }
  addControl() {} on() {} remove() { mocks.remove() }
}, NavigationControl: class {} } }))
afterEach(() => { mocks.effects = []; mocks.refs = []; vi.clearAllMocks(); vi.useRealTimers() })
function renderMap() {
  renderToString(<HurricaneMap data={{ status: "active", storm: { id: "storm", name: "Storm", classification: "Hurricane", intensity: "80", pressure: "980", latitudeNumeric: 30, longitudeNumeric: -90, movementDir: 0, movementSpeed: 10, lastUpdate: "now" }, watch_point: { label: "Watch", latitude: 30, longitude: -90 }, track: [{ hour: 0, latitude: 30, longitude: -90, wind_mph: 80 }] }} registerCapture={vi.fn()} onRadarStatus={vi.fn()} onRadarVisible={vi.fn()} printMap={null} />)
  mocks.refs[0].current = {}
  return mocks.effects.at(-1)!() as () => void
}
it("constructs hurricane maps after idle and disposes them on unmount", async () => {
  vi.useFakeTimers()
  const stop = renderMap()
  expect(mocks.create).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(48); await vi.dynamicImportSettled()
  expect(mocks.create).toHaveBeenCalledOnce()
  stop(); expect(mocks.remove).toHaveBeenCalledOnce()
})
it("cancels hurricane map startup before unmount can create a map", async () => {
  vi.useFakeTimers()
  const stop = renderMap(); stop()
  await vi.advanceTimersByTimeAsync(500); await vi.dynamicImportSettled()
  expect(mocks.create).not.toHaveBeenCalled()
})
it("splits Chase maps without editing or dropping the protected situation map", () => {
  const source = readFileSync(new URL("./ChaseWorkspace.tsx", import.meta.url), "utf8")
  expect(source).toContain('lazy(() => import("./OpsWorkstation"))')
  expect(source).toContain('lazy(() => import("../workspaces/ChaseRadarPanel")')
  expect(source).toContain('<DeferredPanel title="Chase situation"')
  expect(source).toContain('routeOverlay={destination ? route.path : undefined}')
  expect(source).toContain('onChaseDestinationSelect={choosingDestination')
  expect(source).toContain('<ChaseIntelRail intel={intel}')
})
it("keeps Mapbox and mosaic implementations out of the hurricane page's eager imports", () => {
  const source = readFileSync(new URL("./HurricaneWatch.tsx", import.meta.url), "utf8")
  expect(source).toContain('import type mapboxgl from "mapbox-gl"')
  expect(source).toContain('const cancelStartup = afterPaintIdle(')
  expect(source).toContain('Promise.all([import("mapbox-gl"), import("../../../../src/map/AtlasMosaicLayer")])')
  expect(source).toContain('if (disposed) return')
  expect(source).toContain('cancelStartup(); cleanup()')
})
