// Offline DOM fixture; fetch is mocked and no app server is used.
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import ProgramMonitor from "./ProgramMonitor"
import ProducerControls from "./ProducerControls"
import FacebookProducerPanel from "./FacebookProducerPanel"
import ProducerWorkspace from "../pages/ProducerWorkspace"
import AegisAlerts from "../pages/AegisAlerts"
import { CoreOpsContext, type CoreOpsContextValue } from "../core/CoreOpsContext"
import { rememberOpsStatus, useSharedOpsStatus } from "../core/useSharedOpsStatus"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __dialogAccessToken: async () => "test-token" })
const results: Record<string, string> = {}
Object.assign(window, { setInterval: () => 1, clearInterval: () => {} })
let bridge = "ONLINE", preview = "IDLE", observedAt: string | undefined
const posts: string[] = []
window.fetch = async (input, init) => {
  const path = String(input)
  if (!path.startsWith("/api/producer/v1/") && !path.startsWith("/api/chase/v1/")) throw new Error(`Unexpected fetch ${path}`)
  if (init?.method === "POST") posts.push(path)
  const body = path.endsWith("facebook/status") ? { state: "connected", canConnect: true }
    : path.includes("comments?") ? { comments: [], state: "offline" }
    : { bridge, observedAt, controlAccess: { allowed: true, userId: "test" }, status: { engine: "obs", stateRevision: 1, previews: { program: { state: preview } } } }
  return new Response(JSON.stringify(body))
}
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function button(text: string) {
  const result = Array.from(document.querySelectorAll("button")).find(item => item.textContent === text)
  check(result, `Missing ${text}`); return result
}
async function scenario(name: string, run: (root: ReturnType<typeof createRoot>) => Promise<void>) {
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  try { await run(root); results[name] = "passed" }
  catch (error) { results[name] = String(error instanceof Error ? error.stack : error) }
  finally { act(() => root.unmount()); host.remove(); posts.length = 0 }
}
const good = {
  core: { state: "LIVE", detail: "Core ready", checkedAt: Date.now() },
  fabric: { state: "LIVE", detail: "Fabric ready", checkedAt: Date.now(), health: null, units: { units: [{ unit_id: "spencer" }, { unit_id: "nick" }] }, unitsReceivedAt: Date.now(), streamState: "open", lastStreamEventAt: Date.now(), lastContactAt: Date.now(), error: null },
}
function value(state: unknown): CoreOpsContextValue { return { config: {}, state, selectedPoint: null, selectPoint: () => {} } as unknown as CoreOpsContextValue }
export function HookConsumer() {
  const { core, fabric } = useSharedOpsStatus()
  return <p>{core.state} / {fabric.state}: {fabric.units?.units.map(unit => unit.unit_id).join(",")}</p>
}
async function run() {
  await scenario("monitor lifecycle", async root => {
    const running: boolean[] = []
    const report = (state: boolean) => { running.push(state) }
    act(() => root.render(<ProgramMonitor active canStart fallback={<p>Fallback</p>} onRunningChange={report} />))
    check(!running.includes(true), "Idle monitor reported a running session")
    await act(async () => { button("Start video monitor").click(); await tick() })
    check(running.at(-1) === true, "Started monitor did not report session")
    act(() => button("Stop monitor").click())
    check(running.at(-1) === false, "Stopped monitor retained session")
  })
  await scenario("producer offline and link targets", async root => {
    bridge = "OFFLINE"; preview = "ACTIVE"
    await act(async () => { root.render(<MemoryRouter><CoreOpsContext.Provider value={value(good)}><ProducerWorkspace /></CoreOpsContext.Provider></MemoryRouter>); await tick() })
    await act(async () => { await tick() })
    const stage = document.querySelector('[aria-label="PROGRAM preview"]')!
    check(stage.textContent?.includes("Bridge offline"), "Missing offline bridge label")
    check(!stage.textContent?.includes("Preview: ACTIVE") && !stage.textContent?.includes("OBS_CONNECTED"), "Stale producer status shown as live")
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".producer-workspace a"))
    check(links.length > 0 && links.every(link => link.getBoundingClientRect().height >= 44), "Producer link hit area below 44px at 390px")
  })
  for (const [name, connection, state, disabled, stale] of [
    ["idle monitor", "ONLINE", "ACTIVE", true], ["offline monitor", "OFFLINE", "ACTIVE", true], ["active monitor", "ONLINE", "ACTIVE", false, false], ["stale monitor", "ONLINE", "ACTIVE", true, true],
  ] as const) await scenario(name, async root => {
    bridge = connection; preview = state; observedAt = stale ? new Date(Date.now() - 180_000).toISOString() : undefined
    await act(async () => { root.render(<ProducerControls monitorRunning={name === "active monitor" || name === "stale monitor" || name === "offline monitor"} />); await tick() })
    await act(async () => { await tick() })
    check(button("Stop private monitor").disabled === disabled, `Incorrect disabled state for ${name}`)
  })
  await scenario("reconnect confirmation", async root => {
    await act(async () => { root.render(<FacebookProducerPanel />); await tick() })
    await act(async () => { await tick() })
    check(!button("Reconnect Facebook").disabled, "Reconnect unavailable")
    act(() => button("Reconnect Facebook").click())
    check(document.querySelector('[role="alertdialog"]'), "Missing ConfirmDialog")
    check(posts.length === 0, "Reconnect sent before confirmation")
    act(() => button("Cancel").click())
    check(!document.querySelector('[role="alertdialog"]') && posts.length === 0, "Cancel attempted reconnect")
  })
  await scenario("shared hook navigation", async root => {
    rememberOpsStatus(good as CoreOpsContextValue["state"])
    act(() => root.render(<CoreOpsContext.Provider value={value(good)}><HookConsumer /></CoreOpsContext.Provider>))
    check(document.body.textContent?.includes("LIVE / LIVE: spencer,nick"), "Producer snapshot missing")
    const checking = { core: { ...good.core, state: "CHECKING" }, fabric: { ...good.fabric, state: "CHECKING", units: null, streamState: "connecting" } }
    act(() => root.render(<CoreOpsContext.Provider key="chase" value={value(checking)}><HookConsumer /><HookConsumer /></CoreOpsContext.Provider>))
    const labels = Array.from(document.querySelectorAll("p")).map(item => item.textContent)
    check(labels.length === 2 && labels.every(label => label === "STALE / STALE: spencer,nick"), "Consumers disagreed or reset on navigation")
  })
  await scenario("Aegis radar health", async root => {
    await act(async () => { root.render(<MemoryRouter><CoreOpsContext.Provider value={value(good)}><AegisAlerts /></CoreOpsContext.Provider></MemoryRouter>); await tick() })
    const text = document.body.textContent ?? ""
    check(text.includes("radar \u00b7 LIVE"), "Aegis did not use radar service health")
    check(text.includes("Shadow screening \u00b7 OFFLINE"), "Shadow screening was not separated")
    check(text.includes("SHADOW / NO DELIVERY"), "Shadow delivery missing")
  })
  const output = document.createElement("pre"); output.id = "results"
  output.textContent = Array.from(new TextEncoder().encode(JSON.stringify(results)), byte => byte.toString(16).padStart(2, "0")).join("")
  document.body.append(output)
}
void run()
