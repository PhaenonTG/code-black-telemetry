import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [join(root, "../src/producer-bridge.ts")],
  outfile: join(root, "../dist-private/producer-bridge.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
});
