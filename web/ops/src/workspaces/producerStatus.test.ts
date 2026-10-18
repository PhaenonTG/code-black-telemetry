import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { build } from "esbuild"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// The supplied node_modules has no jsdom. Exercise React act() in an isolated,
// headless local browser instead; no server, dependency installation, or live API.
// Other review hosts can set OPS_TEST_BROWSER to a Chromium/Chrome/Edge executable.
const ops = fileURLToPath(new URL("../../", import.meta.url))
const browser = process.env.OPS_TEST_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].find(existsSync)
let temporary = ""
let results: Record<string, string> = {}
const cases = ["idle monitor", "offline monitor", "active monitor", "stale monitor", "monitor lifecycle", "reconnect confirmation", "shared hook navigation", "Aegis radar health", "producer offline and link targets"]

beforeAll(async () => {
  if (!browser) throw new Error("Set OPS_TEST_BROWSER to a local Chromium browser to run broadcast dialog DOM tests (no jsdom is installed).")
  temporary = await mkdtemp(path.join(ops, ".producer-status-test-"))
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./producerStatus.browser.tsx", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" }, loader: { ".css": "empty" },
    alias: { react: path.join(ops, "node_modules/react"), "react-dom": path.join(ops, "node_modules/react-dom") },
    plugins: [{ name: "mock-producer-services", setup(builder) {
      builder.onResolve({ filter: /\/(?:ProducerSituationMap|PreparePcControls)$/ }, ({ path: name }) => ({ path: name, namespace: "producer-child" }))
      builder.onLoad({ filter: /.*/, namespace: "producer-child" }, ({ path: name }) => ({ contents: name.endsWith("ProducerSituationMap") ? 'export const ProducerSituationMap=()=>null' : name.endsWith("ProgramMonitor") ? 'export default function Monitor(props){return props.fallback}' : 'export default ()=>null' }))
      builder.onResolve({ filter: /^hls\.js$/ }, () => ({ path: "hls", namespace: "hls" }))
      builder.onLoad({ filter: /.*/, namespace: "hls" }, () => ({ contents: 'export default class Hls { static Events={LEVEL_LOADED:"level",ERROR:"error",MANIFEST_PARSED:"manifest"}; static isSupported(){return true} constructor(){this.listeners={}} on(event,fn){this.listeners[event]=fn} attachMedia(){} loadSource(){queueMicrotask(()=>this.listeners.manifest?.())} destroy(){} }' }))
      builder.onResolve({ filter: /\/status\/statusCenterClient$/ }, () => ({ path: "status", namespace: "status" }))
      builder.onLoad({ filter: /.*/, namespace: "status" }, () => ({ contents: 'export const fetchStatusCenter=async()=>({streaming:{}})' }))
      builder.onResolve({ filter: /\/core\/aegisFeed$/ }, () => ({ path: "aegis", namespace: "aegis" }))
      builder.onLoad({ filter: /.*/, namespace: "aegis" }, () => ({ contents: 'export const getAegisStatus=async()=>({delivery_enabled:false,screen:{cutoff:85}}); export const getAegisFeed=async()=>({items:[]}); export const getAegisObservationPlan=async()=>({executor:{state:"shadow"},setup_drafts:[],live_chasers:[],gates:{radar:"OFFLINE"},radar:{dominant_cell:{freshness_state:"OFFLINE"}}}); export const replayAegisPolicy=async()=>({mode:"recorded",scans:[],scans_reviewed:0,candidates_reviewed:0})' }))
      builder.onResolve({ filter: /services\/radar$/ }, () => ({ path: "radar", namespace: "radar" }))
      builder.onLoad({ filter: /.*/, namespace: "radar" }, () => ({ contents: 'export const getRadarStatus=async()=>({backendState:"READY",selectedSite:"KSRX",dataAgeSeconds:30})' }))
      builder.onResolve({ filter: /\/status\/externalHealth$/ }, () => ({ path: "health", namespace: "health" }))
      builder.onLoad({ filter: /.*/, namespace: "health" }, () => ({ contents: 'export const interpretRadarStatus=s=>({state:s.backendState==="READY"?"LIVE":"UNAVAILABLE",detail:"KSRX"})' }))
      builder.onResolve({ filter: /^(?:\.\/client|.*\/core\/client)$/ }, () => ({ path: "client", namespace: "mock" }))
      builder.onResolve({ filter: /\/producerRateLimit$/ }, () => ({ path: "rate", namespace: "mock" }))
      builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path: name }) => ({ contents: name === "client"
        ? 'export const currentAccessToken = async () => globalThis.__dialogAccessToken(); export const fetchStormIntelPoint = async () => ({}); export const fetchForecast = async () => ({alerts:[]})'
        : 'export const producerReadAllowed = () => true; export const producerRetryMessage = () => "retry"; export const noteProducerResponse = () => {}' }))
    } }],
  })
  const page = path.join(temporary, "test.html")
  await writeFile(page, `<!doctype html><meta charset="utf-8"><style>${readFileSync(path.join(ops, "src/pages/ProducerWorkspace.css"), "utf8")}</style><body><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`)
  const { stdout } = await promisify(execFile)(browser, [
    "--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(temporary, "profile")}`, "--virtual-time-budget=10000", "--window-size=390,844", "--dump-dom", pathToFileURL(page).href,
  ], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
  const encoded = stdout.match(/<pre id="results">([a-f0-9]+)<\/pre>/)?.[1]
  if (!encoded) throw new Error(`Browser did not finish the dialog DOM fixture: ${stdout.slice(-2000)}`)
  results = JSON.parse(Buffer.from(encoded, "hex").toString("utf8"))
}, 40_000)
afterAll(async () => {
  // Profile and generated page are always created inside this worktree.
  if (temporary && path.dirname(temporary) === path.resolve(ops) && path.basename(temporary).startsWith(".producer-status-test-")) {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
describe("producer status and controls (React DOM)", () => {
  it.each(cases)("%s", name => { expect(results[name], results[name]).toBe("passed") })
})
