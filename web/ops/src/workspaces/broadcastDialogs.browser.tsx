// Real DOM fixture for broadcastDialogs.test.ts. All API reads/writes are mocked.
import { act, StrictMode, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import ConfirmDialog from "../components/ConfirmDialog"
import ObsOutputControls from "./ObsOutputControls"
import ProducerControls from "./ProducerControls"
import type { ObsOutputStatus } from "./obsOutputPolicy"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const results: Record<string, string> = {}
const intervals = new Map<number, { run: TimerHandler; delay?: number }>()
let intervalId = 0
Object.assign(window, {
  setInterval: (run: TimerHandler, delay?: number) => { intervals.set(++intervalId, { run, delay }); return intervalId },
  clearInterval: (id: number) => { intervals.delete(id) },
})
let host: HTMLDivElement
let root: Root
const commands: unknown[][] = []
const posts: { path: string; body: Record<string, unknown> }[] = []
const composition = "a".repeat(24)
let readToken = async () => "test-token"
Object.assign(globalThis, { __dialogAccessToken: () => readToken() })
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function dialog() { return document.querySelector<HTMLElement>('[role="alertdialog"]') }
function button(text: string) {
  const found = Array.from(document.querySelectorAll("button")).find(element => element.textContent?.startsWith(text))
  check(found, `Missing button: ${text}`)
  return found
}
function open(text: string) {
  const opener = button(text)
  check(!opener.disabled, `${text} is disabled`)
  opener.focus()
  act(() => opener.click())
  return opener
}
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0))
async function click(text: string) { await act(async () => { button(text).click(); await tick() }) }
function key(key: string, shiftKey = false) {
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })))
}
function verify() { act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()) }
function accessible(consequence: string) {
  const modal = dialog()
  check(modal?.getAttribute("aria-modal") === "true", "Missing modal semantics")
  check(document.getElementById(modal.getAttribute("aria-labelledby")!)?.textContent?.includes("Confirm"), "Title is not linked")
  check(document.getElementById(modal.getAttribute("aria-describedby")!)?.textContent?.includes(consequence), "Consequence is not linked")
  check(document.activeElement?.textContent === "Cancel", "Initial focus is not Cancel")
}
async function scenario(name: string, run: () => void | Promise<void>) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  commands.length = 0
  posts.length = 0
  try { await run(); results[name] = "passed" }
  catch (error) { results[name] = String(error instanceof Error ? error.stack : error) }
  finally { act(() => root.unmount()); host.remove(); intervals.clear(); readToken = async () => "test-token" }
}
export function Harness() {
  const [visible, setVisible] = useState(false)
  return <><button onClick={() => setVisible(true)}>Open confirmation</button>
    {visible && <ConfirmDialog title="Confirm output" consequence="PROGRAM will go public on Facebook." onCancel={() => setVisible(false)}>
      <input type="checkbox" aria-label="Verified" /><button disabled>Confirm start</button>
    </ConfirmDialog>}
  </>
}
function mountHarness() { act(() => root.render(<StrictMode><Harness /></StrictMode>)) }
function readyObs(): ObsOutputStatus {
  return {
    engine: "obs", source_state: "SOURCE_LIVE", composition: { id: composition },
    program: { state: "RENDERING" }, audio: { available: true, state: "SIGNAL" },
    outputs: { facebook: { configured: true, state: "OFF", destination: "page-a" }, youtube: { configured: true, state: "OFF", destination: "channel-a" } },
    capabilities: { actions: { outputs: ["facebook.start", "facebook.stop", "youtube.start", "youtube.stop"] } },
  }
}
function renderObs(status: ObsOutputStatus) {
  act(() => root.render(<ObsOutputControls status={status} owner allowed online busy={false} onCommand={async (...args) => { commands.push(args) }} />))
}
function readyProducer() {
  return {
    bridge: "ONLINE", controlAccess: { allowed: true, userId: "operator" },
    controlLease: { userId: "operator", operator: "Test", expiresAt: Date.now() + 600_000 },
    status: { engine: "ffmpeg", stateRevision: 1, source_state: "SOURCE_LIVE", composition: { id: composition }, audio: { available: true, state: "SIGNAL" }, broadcast: { state: "SENDING", managedVideoId: "video-a" } },
  }
}
let status = readyProducer()
let facebook: { enabled: boolean; permission: boolean; canManage: boolean; broadcast: { id: string; title: string; status: string; description: string; facebookProducerUrl: string } | null }
window.fetch = async (input, init) => {
  const path = String(input)
  check(path.startsWith("/api/producer/v1/"), `Unexpected fetch: ${path}`)
  if (init?.method === "POST") {
    posts.push({ path, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(path.endsWith("/commands") ? { commandId: "test-command", state: "done" } : {}))
  }
  return new Response(JSON.stringify(path.endsWith("/facebook") ? facebook : status))
}
async function mountProducer(managed = true) {
  status = readyProducer()
  facebook = { enabled: true, permission: true, canManage: true, broadcast: managed ? { id: "video-a", title: "Storm coverage", status: "UNPUBLISHED", description: "", facebookProducerUrl: "#preview" } : null }
  if (!managed) status.status.broadcast.managedVideoId = ""
  await act(async () => {
    root.render(<ProducerControls />)
    await new Promise(resolve => window.setTimeout(resolve, 0))
  })
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)) })
}
async function poll() {
  await act(async () => {
    for (const { run, delay } of intervals.values()) if ((delay === 30_000 || delay === 60_000) && typeof run === "function") run()
    await new Promise(resolve => window.setTimeout(resolve, 0))
  })
}

async function run() {
  await scenario("dialog focus and semantics", () => {
    mountHarness(); open("Open confirmation"); accessible("PROGRAM will go public on Facebook.")
  })
  await scenario("Escape restores opener", () => {
    mountHarness(); const opener = open("Open confirmation"); key("Escape")
    check(!dialog() && document.activeElement === opener, "Escape did not cancel and restore focus")
    check(!host.hasAttribute("inert"), "Background stayed inert")
  })
  await scenario("native cancel restores opener", () => {
    mountHarness(); const opener = open("Open confirmation")
    const event = new Event("cancel", { cancelable: true })
    act(() => dialog()!.dispatchEvent(event))
    check(event.defaultPrevented && !dialog() && document.activeElement === opener, "Native dialog cancel did not restore focus")
  })
  await scenario("Tab wraps and skips disabled controls", () => {
    mountHarness(); open("Open confirmation")
    const checkbox = document.querySelector("input")
    key("Tab"); check(document.activeElement === checkbox, "Forward Tab escaped")
    key("Tab", true); check(document.activeElement?.textContent === "Cancel", "Reverse Tab escaped")
    key("Tab", true); check(document.activeElement === checkbox, "Reverse Tab hit disabled confirm")
    key("Tab"); check(document.activeElement?.textContent === "Cancel", "Forward Tab hit disabled confirm")
  })
  await scenario("Cancel restores focus and removes listeners", async () => {
    mountHarness(); const opener = open("Open confirmation"); await click("Cancel")
    check(!dialog() && document.activeElement === opener, "Cancel did not restore focus")
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    opener.dispatchEvent(event); check(!event.defaultPrevented, "Tab listener leaked")
  })
  for (const target of ["facebook", "youtube"] as const) {
    const label = target === "facebook" ? "Facebook" : "YouTube"
    const destination = target === "facebook" ? "Storm Chaser Nick Mounce" : "Code Black WX"
    for (const operation of ["start", "stop"] as const) await scenario(`OBS ${target} ${operation}`, async () => {
      const current = readyObs()
      if (target === "youtube") current.outputs!.facebook!.state = "SENDING"
      if (operation === "stop") current.outputs![target]!.state = "SENDING"
      renderObs(current)
      const opener = open(`${operation === "start" ? "Start" : "Stop"} ${label}`)
      accessible(destination)
      key("Escape"); check(!dialog() && document.activeElement === opener, "OBS Escape failed")
      check(commands.length === 0, "Cancel sent a command")
      open(`${operation === "start" ? "Start" : "Stop"} ${label}`)
      if (operation === "start") { check(button(`Confirm start ${target}`).disabled, "Start did not require verification"); verify() }
      await click(`Confirm ${operation} ${target}`)
      check(JSON.stringify(commands) === JSON.stringify([[`obs.output.${target}.${operation}`, true, operation === "start" ? composition : undefined]]), "Command contract changed")
      check(document.activeElement === opener, "Confirmed OBS action did not restore focus")
    })
  }
  for (const field of ["composition", "destination"]) await scenario(`OBS invalidates ${field}`, () => {
    let current = readyObs(); renderObs(current); open("Start Facebook"); verify()
    const stale = button("Confirm start facebook")
    check(!stale.disabled, "Verified confirmation was disabled")
    current = field === "composition" ? { ...current, composition: { id: "b".repeat(24) } } : { ...current, outputs: { ...current.outputs, facebook: { ...current.outputs!.facebook, destination: "page-b" } } }
    renderObs(current); check(!dialog(), "Stale OBS dialog stayed open")
    act(() => stale.click()); check(commands.length === 0, "Stale OBS confirm sent a command")
    open("Start Facebook"); check(button("Confirm start facebook").disabled, "Old verification survived")
  })
  for (const [label, consequence] of [
    ["Send to Facebook preview", "managed broadcast video-a"],
    ["Go Live on Facebook", "publicly on Storm Chaser Nick Mounce"],
    ["End Facebook broadcast", "Viewers will lose this live broadcast"],
    ["Prepare non-public broadcast", "Create a non-public broadcast on Storm Chaser Nick Mounce"],
    ["Start Facebook output", "configured Facebook stream key"],
  ]) await scenario(`Facebook dialog ${label}`, async () => {
    await mountProducer(!label.startsWith("Prepare") && !label.startsWith("Start"))
    const opener = open(label); accessible(consequence); key("Escape")
    check(!dialog() && document.activeElement === opener, "Facebook Escape failed")
    check(posts.length === 0, "Escape sent a request")
  })
  for (const field of ["video", "composition"]) await scenario(`Facebook invalidates ${field}`, async () => {
    await mountProducer(); open("Send to Facebook preview")
    const stale = button("Confirm start Facebook output")
    if (field === "video") { facebook.broadcast = { ...facebook.broadcast!, id: "video-b", title: "New coverage" }; status.status.broadcast.managedVideoId = "video-b" }
    else status.status.composition.id = "b".repeat(24)
    await poll(); check(!dialog(), "Stale Facebook dialog stayed open")
    act(() => stale.click()); check(posts.length === 0, "Stale Facebook confirmation sent")
    facebook.broadcast = { ...facebook.broadcast!, id: "video-a", title: "Storm coverage" }
    status = readyProducer(); await poll(); check(!dialog(), "Old confirmation resurrected")
    open("Send to Facebook preview"); await click("Confirm start Facebook output")
    check(Number(posts.length) === 1 && posts[0].path.endsWith("/commands"), "Reconfirmation did not send")
    const body = posts[0].body
    check(body.action === "facebook.output.start" && body.confirmed === true && (body.payload as { videoId: string }).videoId === "video-a", "Facebook command contract changed")
  })
  await scenario("Facebook rejects fresh status identity change", async () => {
    await mountProducer(); open("Send to Facebook preview"); status.status.composition.id = "b".repeat(24)
    await click("Confirm start Facebook output")
    check(posts.length === 0 && host.textContent?.includes("changed after confirmation"), "Fresh status did not block stale start")
  })
  for (const action of ["output", "publish"]) await scenario(`Facebook invalidates ${action} before fetch`, async () => {
    await mountProducer()
    const opener = open(action === "output" ? "Send to Facebook preview" : "Go Live on Facebook")
    if (action === "publish") verify()
    let reads = 0
    let release!: (token: string) => void
    const delayedToken = new Promise<string>(resolve => { release = resolve })
    readToken = async () => ++reads === (action === "output" ? 2 : 1) ? delayedToken : "test-token"
    await click(action === "output" ? "Confirm start Facebook output" : "Confirm public Go Live")
    check(posts.length === 0, "Confirmation sent before token was available")
    facebook.broadcast = { ...facebook.broadcast!, id: "video-b", title: "Different broadcast" }
    status.status.broadcast.managedVideoId = "video-b"
    await poll()
    await act(async () => { release("test-token"); await tick() })
    check(posts.length === 0, "Identity changed while awaiting token but a stale request was sent")
    check(host.textContent?.includes("changed after confirmation"), "Missing reconfirmation message")
    check(document.activeElement === opener, "Focus did not return after command completed")
  })
  await scenario("Facebook invalidates public Go Live approval", async () => {
    await mountProducer(); open("Go Live on Facebook"); verify()
    const stale = button("Confirm public Go Live"); check(!stale.disabled, "Preview verification failed")
    facebook.broadcast = { ...facebook.broadcast!, id: "video-b" }; status.status.broadcast.managedVideoId = "video-b"
    await poll(); check(!dialog(), "Stale public Go Live stayed open")
    act(() => stale.click()); check(posts.length === 0, "Stale public Go Live sent")
    open("Go Live on Facebook"); check(button("Confirm public Go Live").disabled, "Public Go Live verification survived identity change")
  })
  const output = document.createElement("pre")
  output.id = "results"
  output.textContent = Array.from(new TextEncoder().encode(JSON.stringify(results)), byte => byte.toString(16).padStart(2, "0")).join("")
  document.body.append(output)
}
void run()
