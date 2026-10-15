import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [join(root, "private-core-gateway.ts")],
  outfile: join(root, "../dist-private/core-gateway.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
});
