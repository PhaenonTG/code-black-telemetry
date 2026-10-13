import { chromium } from "playwright";

const baseUrl = (process.env.OPS_SMOKE_URL || "https://ops.codeblackwx.com").replace(/\/$/, "");
const email = process.env.OPS_SMOKE_EMAIL;
const password = process.env.OPS_SMOKE_PASSWORD;
if (!email || !password) {
  console.error("OPS smoke needs OPS_SMOKE_EMAIL and OPS_SMOKE_PASSWORD for an active operator account.");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["geolocation"], { origin: baseUrl });
await context.setGeolocation({ latitude: 39.0473, longitude: -95.6752, accuracy: 30 });
const page = await context.newPage();
const errors = [];
const coreResponses = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.origin === baseUrl && url.pathname.startsWith("/api/core/")) {
    coreResponses.push({ path: url.pathname, status: response.status() });
  }
});

function check(condition, detail) {
  if (!condition) throw new Error(detail);
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("EMAIL").fill(email);
  await page.getByLabel("PASSWORD").fill(password);
  await page.getByRole("button", { name: "AUTHENTICATE" }).click();
  await page.getByRole("navigation", { name: "Primary" }).waitFor({ timeout: 20_000 });
  check(!(await page.getByText("AUTHENTICATION FAILED").isVisible()), "OPS sign-in failed");

  await page.goto(`${baseUrl}/radar`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "RADAR LAB" }).waitFor();
  await page.locator(".mapboxgl-canvas").first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => {
    try {
      const value = JSON.parse(localStorage.getItem("codeblack.map.diagnostics") || "null");
      return value?.provider === "mapbox" && value.styleLoaded && /night|dark/i.test(value.styleUri);
    } catch { return false; }
  }, null, { timeout: 25_000 });

  await page.goto(`${baseUrl}/weather`, { waitUntil: "domcontentloaded" });
  await page.locator(".storm-workspace").waitFor();
  await page.locator(".mapboxgl-canvas").first().waitFor({ timeout: 20_000 });
  const pointResponse = page.waitForResponse((response) =>
    response.url().includes("/api/core/api/storm-intel/v1/point?") && response.status() === 200,
  { timeout: 35_000 });
  await page.locator(".mapboxgl-canvas").first().click({ position: { x: 180, y: 170 } });
  await pointResponse;

  const aegisResponse = page.waitForResponse((response) =>
    response.url().includes("/api/core/api/fabric/v1/aegis-status") && response.status() === 200,
  { timeout: 20_000 });
  await page.goto(`${baseUrl}/aegis-alerts`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Aegis Radar Alerts" }).waitFor();
  await page.getByRole("region", { name: "Aegis alert feed" }).waitFor();
  await aegisResponse;

  // Forecast controls may be feature-flagged off. Exercise the same authenticated
  // Core gateway the UI uses without printing or exporting the session token.
  const forecastStatus = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((item) => /^sb-.+-auth-token$/.test(item));
    const token = key ? JSON.parse(localStorage.getItem(key) || "null")?.access_token : null;
    if (!token) return 0;
    const response = await fetch("/api/core/api/forecast/v1/runs", {
      cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    return response.status;
  });
  check(forecastStatus === 200, `Forecast gateway returned HTTP ${forecastStatus || "no session"}`);

  const required = ["/api/core/api/fabric/v1/units", "/api/core/api/storm-intel/v1/point", "/api/core/api/fabric/v1/aegis-status"];
  for (const path of required) {
    check(coreResponses.some((item) => item.path === path && item.status === 200), `${path} did not return HTTP 200`);
  }
  check(errors.length === 0, `Browser exceptions: ${errors.join("; ")}`);
  console.log(`OPS LIVE SMOKE PASS: sign-in, dark Mapbox, selected point, Fabric, forecast and Aegis (${baseUrl})`);
} catch (error) {
  console.error(`OPS LIVE SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Core response statuses: ${coreResponses.map((item) => `${item.path}=${item.status}`).join(", ") || "none"}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
