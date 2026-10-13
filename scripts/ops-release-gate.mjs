import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const name of ["OPS_SMOKE_URL", "OPS_SMOKE_EMAIL", "OPS_SMOKE_PASSWORD"]) {
  if (!process.env[name]) {
    console.error(`OPS release gate requires ${name}; use the candidate Pages preview URL and an active test operator.`);
    process.exit(2);
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  ["run", "typecheck"],
  ["test"],
  ["run", "build"],
];
for (const args of commands) {
  const result = spawnSync(npm, args, { cwd: fileURLToPath(new URL("../web/ops/", import.meta.url)), stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const smoke = spawnSync(process.execPath, [fileURLToPath(new URL("./ops-live-smoke.mjs", import.meta.url))], { stdio: "inherit" });
if (smoke.error) throw smoke.error;
process.exit(smoke.status ?? 1);
