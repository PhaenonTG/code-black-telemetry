// Bundles worker/entry.ts (the Cloudflare Pages Advanced Mode gateway) into dist/_worker.js
// after `vite build` has produced the rest of dist/. Run via `npm run build`, never directly.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");

await build({
  entryPoints: [path.join(root, "worker/entry.ts")],
  outfile: path.join(root, "dist/_worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
});

console.log("Built dist/_worker.js (Cloudflare Pages Advanced Mode gateway)");
