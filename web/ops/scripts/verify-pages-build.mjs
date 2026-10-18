import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { verifyWorkerDispatch } from "./verify-worker-dispatch.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")
const routes = JSON.parse(await readFile(path.join(dist, "_routes.json"), "utf8"))
const worker = await stat(path.join(dist, "_worker.js"))
if (!worker.isFile() || worker.size < 1000) throw new Error("Pages API worker missing from build")
for (const required of ["/api/core/*", "/api/public/hurricane", "/api/v1/radar/*", "/api/coordination/v1/snapshot"]) {
  if (!routes.include?.includes(required)) throw new Error(`Pages route ${required} missing from build`)
}
const built = await import(pathToFileURL(path.join(dist, "_worker.js")).href)
const checks = await verifyWorkerDispatch(built.default)
console.log(JSON.stringify({ status: "PASS", build: "Pages emitted artifact", ...checks }))
