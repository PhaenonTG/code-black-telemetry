import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-parity"); await mkdir(out, { recursive: true });
const workerRoot = path.join(root, "workers/private-parity-adapter");
const proposal = JSON.parse((await readFile(path.join(workerRoot, "wrangler.proposal.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, ""));
if (proposal.workers_dev !== false || proposal.routes || proposal.name !== "codeblack-private-parity-adapter") throw Error("Internal-only adapter configuration required");
const files = [];
for (const [name, source, platform] of [
  ["worker.mjs", path.join(workerRoot, proposal.main), "neutral"],
  ["origin.mjs", path.join(root, "migration/parityOrigin.ts"), "node"],
  ["origin-cli.mjs", path.join(root, "migration/startParityOrigin.ts"), "node"],
]) {
  const result = await build({ entryPoints: [source], outfile: path.join(out, name), bundle: true, format: "esm", platform, target: "es2022", minify: true, metafile: true });
  if (platform === "neutral" && Object.values(result.metafile.outputs).some(o => o.imports.length)) throw Error("Adapter must be a standalone Worker without Node imports");
  const bytes = await readFile(path.join(out, name));
  files.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), platform });
}
await writeFile(path.join(out, "manifest.json"), JSON.stringify({ schema: "codeblack.private-parity.runtime.v1", minNodeMajor: 22, productionConfigured: false, files }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", builtOnly: true, productionConfigured: false, files }));
