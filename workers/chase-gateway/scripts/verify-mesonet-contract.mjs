import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode === "pre") {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  for (const route of ["/api/chase/mesonet/ingest", "/api/chase/mesonet/ota/check", "/api/chase/mesonet/public"]) {
    if (!source.includes(`url.pathname === "${route}"`)) throw new Error(`Missing Mesonet route: ${route}`);
  }
  const releases = fileURLToPath(new URL("../releases/", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(releases, "update.json"), "utf8"));
  const apk = join(releases, `chase-recovery-${manifest.versionCode}.apk`);
  if (!existsSync(apk)) throw new Error(`Missing current Chase APK: ${apk}`);
  const digest = createHash("sha256").update(readFileSync(apk)).digest("hex");
  if (digest !== manifest.sha256.toLowerCase()) throw new Error("Current Chase APK hash differs from manifest");
  console.log(`Mesonet routes and Chase release ${manifest.versionCode} verified before deploy`);
} else if (mode === "live") {
  const origin = "https://ops.codeblackwx.com";
  const checks = [
    ["GET", "/api/chase/mesonet/ingest", 405],
    ["POST", "/api/chase/mesonet/ota/check", 405],
    ["GET", "/api/chase/mesonet/public", 200],
  ];
  for (const [method, path, expected] of checks) {
    const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000) });
    if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}`);
  }
  console.log("Live Mesonet routes verified");
} else {
  throw new Error("Use pre or live");
}
