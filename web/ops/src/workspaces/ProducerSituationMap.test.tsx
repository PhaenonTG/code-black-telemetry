import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { ProducerSituationMap } from "./ProducerSituationMap"

const mock = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>, refs: [] as Array<{ current: unknown }>,
  create: vi.fn(), remove: vi.fn(), events: new Map<string, (event: { lngLat: { lat: number; lng: number } }) => void>(),
}))
vi.mock("react", async original => {
  const react = await original<typeof import("react")>()
  return { ...react, useRef: (value: unknown) => { const ref = react.useRef(value); mock.refs.push(ref); return ref }, useEffect: (effect: () => void | (() => void)) => mock.effects.push(effect) }
})
vi.mock("../../../../src/services/mapTiles", () => ({ hasMapboxToken: () => true, mapboxAccessToken: () => "", atlasStyleUri: () => "" }))
vi.mock("mapbox-gl", () => ({ default: {
  Map: class { constructor(options: unknown) { mock.create(options) } addControl() {} on(name: string, callback: (event: { lngLat: { lat: number; lng: number } }) => void) { mock.events.set(name, callback) } remove() { mock.remove() } },
  AttributionControl: class {},
} }))
afterEach(() => { mock.effects = []; mock.refs = []; mock.events.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it.each([true, false])("uses cooperative touch gestures only when the primary pointer is coarse (%s)", coarse => {
  const matchMedia = vi.fn().mockReturnValue({ matches: coarse })
  vi.stubGlobal("window", { matchMedia })
  const select = vi.fn()
  renderToString(<ProducerSituationMap selectedPoint={null} units={[]} onPointSelect={select} />)
  mock.refs[0].current = {}
  const stop = mock.effects[0]()
  expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)")
  const options = mock.create.mock.calls[0][0]
  expect(options.cooperativeGestures).toBe(coarse)
  // Leave Mapbox's drag and pinch handlers enabled at their defaults.
  for (const handler of ["dragPan", "touchZoomRotate", "scrollZoom", "interactive"]) expect(options[handler]).toBeUndefined()
  mock.events.get("click")?.({ lngLat: { lat: 36, lng: -94 } })
  expect(select).toHaveBeenCalledWith({ lat: 36, lon: -94 })
  stop?.()
  expect(mock.remove).toHaveBeenCalledOnce()
})

it("retains default mouse gestures when matchMedia is unavailable", () => {
  vi.stubGlobal("window", {})
  renderToString(<ProducerSituationMap selectedPoint={null} units={[]} onPointSelect={() => {}} />)
  mock.refs[0].current = {}
  const stop = mock.effects[0]()
  expect(mock.create.mock.calls[0][0].cooperativeGestures).toBe(false)
  stop?.()
})
