import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { loadEnv } from "vite"

const env = loadEnv("private", process.cwd(), "VITE_")
const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_CODEBLACK_CORE_BASE_URL"]
for (const name of required) {
  if (!env[name]) throw new Error(`Private build is missing ${name}`)
}

const assetsDir = join(process.cwd(), "dist", "assets")
const scripts = (await readdir(assetsDir)).filter((name) => name.endsWith(".js"))
const bundle = (await Promise.all(scripts.map((name) => readFile(join(assetsDir, name), "utf8")))).join("\n")
for (const name of required) {
  if (!bundle.includes(env[name])) throw new Error(`Private build did not embed ${name}`)
}
console.log("Private sign-in and Core settings are present in the browser build")
