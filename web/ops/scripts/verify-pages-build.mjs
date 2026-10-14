import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")
const routes = JSON.parse(await readFile(path.join(dist, "_routes.json"), "utf8"))
const worker = await stat(path.join(dist, "_worker.js"))
if (!worker.isFile() || worker.size < 1000) throw new Error("Pages API worker missing from build")
for (const required of ["/api/core/*", "/api/public/hurricane"]) {
  if (!routes.include?.includes(required)) throw new Error(`Pages route ${required} missing from build`)
}
console.log("Pages build contains the API worker and required routes")
