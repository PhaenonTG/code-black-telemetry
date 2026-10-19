import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { LocationControl } from "./LocationControl"

// Match the repository's offline lifecycle fixtures; no browser or network is used.
const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>,
}))
vi.mock("react", async original => {
  const react = await original<typeof import("react")>()
  return { ...react,
    useRef: (value: unknown) => { const ref = react.useRef(value); lifecycle.refs.push(ref); return ref },
    useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
  }
})
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({
  state: { fabric: { units: null } }, locationMode: "fallback", referenceLabel: "Pea Ridge, AR · fallback",
  referenceIsFallback: true, deviceLocation: { status: "unavailable" },
}) }))

afterEach(() => { lifecycle.effects = []; lifecycle.refs = []; vi.unstubAllGlobals() })

function mount() {
  const document = new EventTarget()
  class FixtureNode extends EventTarget {}
  vi.stubGlobal("document", document)
  vi.stubGlobal("Node", FixtureNode)
  const html = renderToString(<LocationControl />)
  const inside = new FixtureNode()
  const outside = new FixtureNode()
  const chip = { open: true, contains: (node: unknown) => node === inside }
  const trigger = { focus: vi.fn() }
  lifecycle.refs[0].current = chip
  lifecycle.refs[1].current = trigger
  const stop = lifecycle.effects[0]()
  function dispatch(type: string, target: unknown = inside, key?: string) {
    const event = new Event(type, { cancelable: true })
    Object.defineProperties(event, { target: { value: target }, key: { value: key } })
    document.dispatchEvent(event)
    return event
  }
  return { chip, trigger, inside, outside, dispatch, stop, html }
}

it("closes on Escape from the picker and returns focus to the chip", () => {
  const view = mount()
  const event = view.dispatch("keydown", view.inside, "Escape")
  expect(view.chip.open).toBe(false)
  expect(view.trigger.focus).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})

it.each(["pointerdown", "click"])("closes on outside %s without moving focus", type => {
  const view = mount()
  view.dispatch(type, view.outside)
  expect(view.chip.open).toBe(false)
  expect(view.trigger.focus).not.toHaveBeenCalled()
})

it("keeps inside interactions and other keys available to the native details toggle", () => {
  const view = mount()
  expect(view.dispatch("click").defaultPrevented).toBe(false)
  view.dispatch("pointerdown")
  view.dispatch("keydown", view.inside, "Enter")
  expect(view.chip.open).toBe(true)
  // The summary remains native, without an intercepted click handler or controlled open prop.
  expect(view.html).toContain('<summary aria-label="Location: Pea Ridge, AR · fallback. Choose location"')
  expect(view.html).not.toContain(" open=")
})

it("ignores Escape when closed and releases all dismissal listeners on unmount", () => {
  const view = mount()
  view.chip.open = false
  expect(view.dispatch("keydown", view.inside, "Escape").defaultPrevented).toBe(false)
  expect(view.trigger.focus).not.toHaveBeenCalled()
  view.stop?.()
  view.chip.open = true
  view.dispatch("pointerdown", view.outside)
  view.dispatch("click", view.outside)
  view.dispatch("keydown", view.inside, "Escape")
  expect(view.chip.open).toBe(true)
  expect(view.trigger.focus).not.toHaveBeenCalled()
})
