import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
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
const cases = [
  "dialog focus and semantics", "Escape restores opener", "native cancel restores opener", "Tab wraps and skips disabled controls", "Cancel restores focus and removes listeners",
  "OBS facebook start", "OBS facebook stop", "OBS youtube start", "OBS youtube stop",
  "OBS invalidates composition", "OBS invalidates destination",
  "Facebook dialog Send to Facebook preview", "Facebook dialog Go Live on Facebook", "Facebook dialog End Facebook broadcast",
  "Facebook dialog Prepare non-public broadcast", "Facebook dialog Start Facebook output",
  "Facebook invalidates video", "Facebook invalidates composition", "Facebook rejects fresh status identity change", "Facebook invalidates public Go Live approval",
  "Facebook invalidates output before fetch", "Facebook invalidates publish before fetch",
]
beforeAll(async () => {
  if (!browser) throw new Error("Set OPS_TEST_BROWSER to a local Chromium browser to run broadcast dialog DOM tests (no jsdom is installed).")
  temporary = await mkdtemp(path.join(ops, ".broadcast-dialog-test-"))
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./broadcastDialogs.browser.tsx", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, loader: { ".css": "empty" },
    alias: { react: path.join(ops, "node_modules/react"), "react-dom": path.join(ops, "node_modules/react-dom") },
    plugins: [{ name: "mock-producer-services", setup(builder) {
      builder.onResolve({ filter: /\/core\/client$/ }, () => ({ path: "client", namespace: "mock" }))
      builder.onResolve({ filter: /\/producerRateLimit$/ }, () => ({ path: "rate", namespace: "mock" }))
      builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path: name }) => ({ contents: name === "client"
        ? 'export const currentAccessToken = async () => globalThis.__dialogAccessToken()'
        : 'export const producerReadAllowed = () => true; export const producerRetryMessage = () => "retry"; export const noteProducerResponse = () => {}' }))
    } }],
  })
  const page = path.join(temporary, "test.html")
  await writeFile(page, `<!doctype html><meta charset="utf-8"><body><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`)
  const { stdout } = await promisify(execFile)(browser, [
    "--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(temporary, "profile")}`, "--virtual-time-budget=10000", "--dump-dom", pathToFileURL(page).href,
  ], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
  const encoded = stdout.match(/<pre id="results">([a-f0-9]+)<\/pre>/)?.[1]
  if (!encoded) throw new Error(`Browser did not finish the dialog DOM fixture: ${stdout.slice(-2000)}`)
  results = JSON.parse(Buffer.from(encoded, "hex").toString("utf8"))
}, 40_000)
afterAll(async () => {
  // Profile and generated page are always created inside this worktree.
  if (temporary && path.dirname(temporary) === path.resolve(ops) && path.basename(temporary).startsWith(".broadcast-dialog-test-")) {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
describe("accessible broadcast confirmations (React DOM)", () => {
  it.each(cases)("%s", name => { expect(results[name], results[name]).toBe("passed") })
})
