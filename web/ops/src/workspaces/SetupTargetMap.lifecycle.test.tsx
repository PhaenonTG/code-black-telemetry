import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { SetupTargetMap } from "./SetupTargetMap"
const mock = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>, refs: [] as Array<{ current: unknown }>,
  events: new Map<string, () => void>(), remove: vi.fn(), create: vi.fn(),
}))
vi.mock("react", async original => {
  const react = await original<typeof import("react")>()
  return { ...react, useRef: (value: unknown) => { const ref = react.useRef(value); mock.refs.push(ref); return ref }, useEffect: (effect: () => void | (() => void)) => mock.effects.push(effect) }
})
vi.mock("../../../../src/services/mapTiles", () => ({ hasMapboxToken: () => true, mapboxAccessToken: () => "", atlasStyleUri: () => "" }))
vi.mock("mapbox-gl", () => ({ default: {
  Map: class { constructor() { mock.create() } addControl() {} on(name: string, callback: () => void) { mock.events.set(name, callback) } remove() { mock.remove() } },
  AttributionControl: class {},
} }))
afterEach(() => { mock.effects = []; mock.refs = []; mock.events.clear(); mock.create.mockClear(); mock.remove.mockClear() })
it("handles map errors and releases the map on leave without any real WebGL or network", () => {
  renderToString(<SetupTargetMap geometry={undefined} bounds={undefined} points={[]} />)
  mock.refs[0].current = {}
  const stop = mock.effects[0]()
  expect(mock.create).toHaveBeenCalledTimes(1)
  expect(mock.events.has("error")).toBe(true)
  expect(() => mock.events.get("error")?.()).not.toThrow()
  stop?.()
  expect(mock.remove).toHaveBeenCalledTimes(1)
})
