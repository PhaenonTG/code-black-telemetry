import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.TROPICS_QA_URL ?? "http://127.0.0.1:4174";
const live = process.argv.includes("--live");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  if (live) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".mapboxgl-canvas").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: /Refresh data/ }).click();
    await page.waitForTimeout(1500);
    assert.deepEqual(errors, []);
    const imagePath = join(tmpdir(), "tropics-map-live-qa.png");
    await page.screenshot({ path: imagePath, fullPage: true });
    console.log(JSON.stringify({ result: "ok", live: true, screenshot: imagePath }));
  } else {
  const original = await (await context.request.get(`${base}/api/hurricane`)).json();
  assert.ok(original.official?.track?.length > 1, "live fixture needs an NHC track");
  assert.ok(original.projection?.points?.length > 1, "live fixture needs an Aegis track");
  const updated = structuredClone(original);
  updated.checked_at = new Date(Date.parse(original.checked_at) + 60_000).toISOString();
  const shift = (points) => points.forEach((p) => { p.longitude += 3; p.latitude += 1; });
  shift(updated.official.track);
  shift(updated.projection.points);
  for (const model of updated.guidance.models) shift(model.points);
  if (updated.official.cone) updated.official.cone = updated.official.cone.map(([lon, lat]) => [lon + 3, lat + 1]);
  updated.storm.center.longitude += 3;
  updated.storm.center.latitude += 1;
  let current = original;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/hurricane", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) }));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".mapboxgl-canvas").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__qaCanvas = document.querySelector(".mapboxgl-canvas"); });
  const map = page.locator(".map-frame");
  const before = await map.screenshot();
  current = updated;
  await page.getByRole("button", { name: /Refresh data/ }).click();
  await page.waitForTimeout(3000);
  assert.equal(await page.evaluate(() => window.__qaCanvas === document.querySelector(".mapboxgl-canvas")), true, "refresh must retain the live Mapbox canvas");
  const after = await map.screenshot();
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.notEqual(hash(before), hash(after), "map should redraw when all track coordinates change");
  assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  const imagePath = join(tmpdir(), "tropics-map-refresh-qa.png");
  await page.screenshot({ path: imagePath, fullPage: true });
  console.log(JSON.stringify({ result: "ok", canvasRetained: true, mapChanged: true, screenshot: imagePath }));
  }
} finally {
  await browser.close();
}
