import { expect, type Locator, type Page, test } from "@playwright/test";

const routes = [
  { key: "home", dock: "dock-home", route: "route-home", path: "/", heading: /FIELD OVERVIEW|CHASE \/ FIELD STATUS/i },
  { key: "map", dock: "dock-map", route: "route-map", path: "/map", heading: /MOSAIC|LAYERS|FOLLOW/i },
  { key: "weather", dock: "dock-weather", route: "route-weather", path: "/weather", heading: /LOCATION & MOTION|WEATHER OBSERVATIONS/i },
  { key: "alerts", dock: "dock-alerts", route: "route-alerts", path: "/alerts", heading: /ACTIVE ALERTS|ALL ACTIVE PRODUCTS/i },
  { key: "more", dock: "dock-more", route: "route-more", path: "/more", heading: /MORE|OPERATIONS|SETTINGS/i },
  { key: "operations", more: "more-operations", route: "route-operations", path: "/operations", heading: /OPERATIONAL MODE/i },
  { key: "report", more: "more-report", route: "route-report", path: "/report", heading: /SUBMIT REPORT|SPOTTER NETWORK/i },
  { key: "settings", more: "more-settings", route: "route-settings", path: "/settings", heading: /DISPLAY|LIVE OVERLAY TELEMETRY|CHASE SESSION/i },
  { key: "layers", more: "more-layers", route: "route-layers", path: "/layers", heading: /LAYER CONFIGURATION|CODE BLACK CHASER NET/i },
] as const;

const ignoredConsolePatterns = [
  /Download the React DevTools/i,
  /Mapbox GL JS/i,
  /Failed to load resource.*(api\.mapbox\.com|events\.mapbox\.com)/i,
  /Access to fetch at 'https:\/\/www\.spc\.noaa\.gov\/products\/outlook\//i,
  /request failed: https:\/\/www\.spc\.noaa\.gov\/products\/outlook\//i,
  /Failed to load resource: net::ERR_FAILED/i,
  /Access to fetch at 'https:\/\/overpass\.kumi\.systems\/api\/interpreter'/i,
  /request failed: https:\/\/overpass\.kumi\.systems\/api\/interpreter/i,
  /GL Driver Message .*GPU stall due to ReadPixels/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /favicon/i,
];

const runtimeProblems = new WeakMap<Page, { consoleProblems: string[]; pageErrors: string[] }>();

function isKnownExternalProviderUrl(url: string) {
  return /api\.mapbox\.com|events\.mapbox\.com|spotternetwork|weather\.gov|spc\.noaa\.gov|overpass\.kumi\.systems/i.test(url);
}

function isIgnoredConsoleMessage(message: string, sourceUrl = "") {
  if (/Failed to load resource: the server responded with a status of 429 \(Too Many Requests\)/i.test(message) && isKnownExternalProviderUrl(sourceUrl)) {
    return true;
  }
  return ignoredConsolePatterns.some((pattern) => pattern.test(message));
}

test.beforeEach(async ({ page }, testInfo) => {
  const consoleProblems: string[] = [];
  const pageErrors: string[] = [];
  runtimeProblems.set(page, { consoleProblems, pageErrors });

  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (!isIgnoredConsoleMessage(text, message.location().url)) consoleProblems.push(`${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText ?? "";
    if (isKnownExternalProviderUrl(url)) return;
    if (/net::ERR_ABORTED/i.test(failure)) return;
    consoleProblems.push(`request failed: ${url} ${failure}`);
  });

  await page.goto("/");
  await page.locator(".cb-splash").waitFor({ state: "hidden", timeout: 12_000 }).catch(() => undefined);
  await dismissSpotterPrompt(page);

  testInfo.annotations.push({
    type: "console-check",
    description: "Relevant console/page errors are asserted at the end of each test.",
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const problems = runtimeProblems.get(page) ?? { consoleProblems: [], pageErrors: [] };
  const combined = [...problems.consoleProblems, ...problems.pageErrors];
  await testInfo.attach("console-health", {
    body: combined.length ? combined.join("\n") : "No relevant console/page errors captured.",
    contentType: "text/plain",
  });
  expect(combined, "no relevant console/page errors").toEqual([]);
});

async function dismissSpotterPrompt(page: Page) {
  const prompt = page.getByRole("dialog").filter({ hasText: /Spotter Network/i });
  if (!(await prompt.count())) return;
  const skip = prompt.getByRole("button", { name: /skip for now/i }).last();
  await skip.click();
  await expect(prompt).toHaveCount(0);
}

async function activeRoute(page: Page, key: (typeof routes)[number]["key"]) {
  return page.getByTestId(`route-${key}`);
}

async function goToRoute(page: Page, key: (typeof routes)[number]["key"]) {
  const route = routes.find((item) => item.key === key);
  if (!route) throw new Error(`Unknown route ${key}`);
  if ("dock" in route) {
    await page.getByTestId(route.dock).click();
  } else {
    await page.getByTestId("dock-more").click();
    await page.getByTestId(route.more).click();
  }
  await expect(page).toHaveURL(new RegExp(`${route.path === "/" ? "/$" : route.path.replace("/", "\\/")}$`));
  const section = await activeRoute(page, key);
  await expect(section).toHaveAttribute("data-active", "true");
  await expect(section).toContainText(route.heading);
  return section;
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
  expect(Math.max(overflow.scrollWidth, overflow.bodyScrollWidth), "page should not horizontally overflow").toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function expectContainerHasArea(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThan(24);
  expect(box!.height, `${label} height`).toBeGreaterThan(24);
}

function telemetryFixture(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    wind: { speedMph: null, gustMph: null, directionDeg: null, directionCardinal: "--", source: "unavailable", updatedAt: 0 },
    weather: {
      tempF: null,
      dewpointF: null,
      humidity: null,
      pressureMb: null,
      pressureTrend: null,
      rainRateInHr: null,
      rainTotalIn: null,
      source: "unavailable",
      sourceLabel: "UNAVAILABLE",
      updatedAt: 0,
    },
    gps: {
      speedMph: null,
      headingDeg: null,
      headingCardinal: "--",
      elevationFt: null,
      accuracyM: null,
      hdop: null,
      satellites: null,
      hasFix: false,
      lat: 0,
      lon: 0,
      source: "unavailable",
      updatedAt: 0,
    },
    sensors: [
      { id: "nav-esp", label: "nav-esp", online: false, lastPacketAt: 0, packetRateHz: 0 },
      { id: "wx-esp", label: "wx-esp", online: false, lastPacketAt: 0, packetRateHz: 0 },
    ],
    power: { mainBatteryV: null, auxBatteryV: null, charging: null, source: "unavailable", updatedAt: 0 },
    system: { cpuPercent: null, ramPercent: null, storagePercent: null, uptimeSeconds: null, source: "unavailable", updatedAt: 0 },
    status: {
      apiLatencyMs: 0,
      dataAgeSeconds: 0,
      piOnline: false,
      internetOnline: true,
      mode: "tablet",
      updatedAt: now,
      connection: {
        endpoint: "",
        connectionState: "NOT_CONFIGURED",
        lastAttemptAt: now,
        lastConnectedAt: null,
        lastSuccessfulResponseAt: null,
        lastDataAt: null,
        dataAgeMs: null,
        latencyMs: null,
        failureCount: 0,
        lastErrorCode: "NOT_CONFIGURED",
        lastErrorSummary: "Fixture telemetry unavailable.",
        retryAt: null,
        provider: "telemetry",
        transport: "unknown",
        isConfigured: false,
      },
    },
    events: [],
    ...overrides,
  };
}

async function injectTelemetry(page: Page, snapshot: ReturnType<typeof telemetryFixture>) {
  await page.evaluate((nextSnapshot) => {
    const hook = (window as typeof window & { __CODEBLACK_TEST_SET_TELEMETRY__?: (snapshot: unknown) => void }).__CODEBLACK_TEST_SET_TELEMETRY__;
    if (!hook) throw new Error("Telemetry test injection hook is unavailable.");
    hook(nextSnapshot);
  }, snapshot);
}

test.describe("rendered route walkthrough", () => {
  for (const route of routes) {
    test(`${route.key} route renders and keeps map-only actions scoped`, async ({ page }) => {
      const section = await goToRoute(page, route.key);
      await expectContainerHasArea(section, `${route.key} route`);
      await expectNoPageOverflow(page);

      await expect(page.getByTestId("map-action-mark")).toHaveCount(0);
      if (route.key === "map") {
        await expect(page.getByTestId("map-action-escape")).toBeVisible();
        const escapeBox = await page.getByTestId("map-action-escape").boundingBox();
        const mapBox = await section.getByTestId("atlas-map-primary").boundingBox();
        expect(escapeBox, "ESCAPE should have bounds").not.toBeNull();
        expect(mapBox, "map should have bounds").not.toBeNull();
        expect(escapeBox!.x).toBeGreaterThanOrEqual(mapBox!.x);
        expect(escapeBox!.y).toBeGreaterThanOrEqual(mapBox!.y);
        expect(escapeBox!.x + escapeBox!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width + 1);
        expect(escapeBox!.y + escapeBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height + 1);
      } else {
        await expect(page.getByTestId("map-action-escape")).toHaveCount(0);
      }
    });
  }
});

test("home modules render, customize, reorder, and navigate", async ({ page }) => {
  const home = await goToRoute(page, "home");
  await expect(home.getByTestId("home-module-chase")).toBeVisible();
  await expect(home.getByTestId("home-module-radar")).toBeVisible();
  await expect(home.getByTestId("home-module-weather")).toBeVisible();

  await home.getByTestId("home-customize-toggle").click();
  const customize = home.getByTestId("home-customize-panel");
  await expect(customize).toBeVisible();
  await customize.getByLabel(/Weather Now size/i).selectOption("compact");
  await customize.getByLabel(/Move Radar Preview up/i).click();
  await customize.getByTestId("home-customize-alerts").getByLabel(/ON/i).uncheck();
  await expect(home.getByTestId("home-module-alerts")).toHaveCount(0);
  await page.reload();
  await page.locator(".cb-splash").waitFor({ state: "hidden", timeout: 12_000 }).catch(() => undefined);
  await dismissSpotterPrompt(page);
  await expect(page.getByTestId("home-module-alerts")).toHaveCount(0);

  // Whole-module direct action: no more separate "Open ___" button per module (see
  // HomeOverviewPage.tsx moduleNavProps). Clicking the module's header -- not its body -- for the
  // radar module specifically, since the body is a real interactive map that intentionally stops
  // its own clicks from bubbling up to the module's navigate action.
  await page.getByTestId("home-module-radar").locator(".home-module__head").click();
  await expect(page).toHaveURL(/\/map$/);
});

test("home modules navigate to their destination route and customize mode suppresses it", async ({ page }) => {
  const home = await goToRoute(page, "home");

  await expect(home.getByTestId("home-module-weather")).toHaveAttribute("role", "button");
  await home.getByTestId("home-module-weather").click();
  await expect(page).toHaveURL(/\/weather$/);

  await goToRoute(page, "home");
  const alertsModule = page.getByTestId("home-module-alerts");
  await expect(alertsModule).toHaveAttribute("aria-label", /Open Alerts/i);
  await alertsModule.click();
  await expect(page).toHaveURL(/\/alerts$/);

  await goToRoute(page, "home");
  await page.getByTestId("home-module-system").click();
  await expect(page).toHaveURL(/\/operations$/);

  // Customization mode: tapping a module being configured must not navigate away. No role="button"
  // is rendered at all while customizing (not just a disabled handler), so this also doubles as
  // confirming customize mode doesn't leave a dead/confusing focusable element behind.
  await goToRoute(page, "home");
  await page.getByTestId("home-customize-toggle").click();
  await expect(page.getByTestId("home-customize-panel")).toBeVisible();
  await expect(page.getByTestId("home-module-weather")).not.toHaveAttribute("role", "button");
  await page.getByTestId("home-module-weather").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-customize-panel")).toBeVisible();
});

test("map, layer popover, and expanded radar are wired", async ({ page }) => {
  const map = await goToRoute(page, "map");
  await expectContainerHasArea(map.getByTestId("atlas-map-primary"), "primary map shell");
  await expectContainerHasArea(map.getByTestId("atlas-map-canvas-primary"), "primary map canvas area");
  await expect(page.getByTestId("map-action-mark")).toHaveCount(0);
  await expect(page.getByTestId("map-action-escape")).toBeVisible();

  await map.getByTestId("atlas-map-layers-primary").click();
  const layers = map.getByTestId("atlas-map-layers-popover-primary");
  await expect(layers).toBeVisible();
  await expect(layers).toContainText(/Spotter Network/i);
  await expect(layers).toContainText(/Trail/i);
  await expect(layers).toContainText(/Road Conditions/i);
  await expect(layers).toContainText(/Public Cameras/i);
  await expect(layers).toContainText(/Probes - unavailable/i);
  await expect(layers).toContainText(/Chaser Net - unavailable/i);
  await map.getByTestId("atlas-map-layers-close-primary").click();
  await expect(layers).toHaveCount(0);

  await map.getByRole("button", { name: /expand radar/i }).click();
  const dialog = page.getByRole("dialog", { name: /expanded radar interrogation/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("atlas-map-primary")).toBeVisible();
  await page.getByRole("button", { name: /close radar/i }).click();
  await expect(dialog).toBeHidden();
});

test("layers page exposes provider-backed and deferred layer states honestly", async ({ page }) => {
  const section = await goToRoute(page, "layers");
  await expect(section).toContainText(/Wide-Area Mosaic/i);
  await expect(section).toContainText(/Road Conditions/i);
  await expect(section).toContainText(/Public Cameras/i);
  await expect(section).toContainText(/Arkansas DOT IDrive/i);
  await expect(section.getByTestId("layer-row-trafficCameras")).toContainText(/Arkansas public/i);
  await expect(section).toContainText(/Code Black Probes/i);
  await expect(section).toContainText(/unavailable/i);
  await expect(section).toContainText(/backend is not configured/i);
  await expect(section).not.toContainText(/production backend connected/i);
});

test("settings controls expose secure credential and overlay state without showing secrets", async ({ page }) => {
  const section = await goToRoute(page, "settings");
  await expect(section).toContainText(/Live Overlay Telemetry/i);
  await expect(section).toContainText(/Spotter Network/i);
  await expect(section).toContainText(/Command Token/i);
  await expect(section).toContainText(/CONFIGURED|MISSING/i);
  await expect(section).toContainText(/Keystore|MEMORY-ONLY-DEV|UNAVAILABLE/i);

  await section.getByRole("button", { name: /^On$/ }).first().click();
  await section.getByRole("button", { name: /^Off$/ }).first().click();
  await expect(page.getByTestId("map-action-mark")).toHaveCount(0);
  await expect(page.getByTestId("map-action-escape")).toHaveCount(0);
});

test("operations diagnostics separate transport health from telemetry freshness", async ({ page }) => {
  const now = Date.now();
  await injectTelemetry(page, telemetryFixture({
    sensors: [
      { id: "nav-esp", label: "nav-esp", online: true, lastPacketAt: now - 120_000, packetRateHz: 1.2 },
    ],
    status: {
      apiLatencyMs: 22,
      dataAgeSeconds: 240,
      piOnline: true,
      internetOnline: true,
      mode: "pi",
      updatedAt: now - 240_000,
      connection: {
        endpoint: "http://192.168.4.1:5000",
        connectionState: "CONNECTED",
        lastAttemptAt: now - 5_000,
        lastConnectedAt: now - 5_000,
        lastSuccessfulResponseAt: now - 5_000,
        lastDataAt: now - 240_000,
        dataAgeMs: 240_000,
        latencyMs: 22,
        failureCount: 0,
        lastErrorCode: null,
        lastErrorSummary: null,
        retryAt: null,
        provider: "vehicle-node",
        transport: "local-network",
        isConfigured: true,
      },
    },
  }));
  const operations = await goToRoute(page, "operations");
  await expect(operations).toContainText(/VEHICLE NODE MODE/i);
  await expect(operations).toContainText(/PI TRANSPORT · CONNECTED/i);
  await expect(operations).toContainText(/TELEMETRY · STALE/i);

  const settings = await goToRoute(page, "settings");
  await expect(settings).toContainText(/Pi Transport/i);
  await expect(settings).toContainText(/CONNECTED/i);
  await expect(settings).toContainText(/Telemetry Data/i);
  await expect(settings).toContainText(/STALE/i);
});

test("shared Chase UI starts and ends without native-service claims", async ({ page }) => {
  const section = await goToRoute(page, "settings");
  const start = section.getByRole("button", { name: /^Start$/ });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole("status").filter({ hasText: /CHASE ACTIVE/i })).toBeVisible();
  await expect(section.getByRole("button", { name: /^End$/ })).toBeEnabled();

  await section.getByRole("button", { name: /^End$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /CHASE ACTIVE/i })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /^Start$/ })).toBeEnabled();
});

test("alerts and report surfaces render without accidental external submission", async ({ page }) => {
  const alerts = await goToRoute(page, "alerts");
  await expect(alerts).toContainText(/ACTIVE ALERTS|ALL ACTIVE PRODUCTS/i);
  await expect(alerts).not.toContainText(/Chaser Net official warning/i);

  const report = await goToRoute(page, "report");
  await expect(report).toContainText(/Submit Report|Spotter Network/i);
  await expect(report).toContainText(/Sign in to Spotter Network in Settings before submitting a report/i);
  await expect(report.getByRole("button", { name: /Submit Report/i })).toHaveCount(0);
  await expect(report).toContainText(/Spotter Network/i);
  await expect(page.getByTestId("map-action-mark")).toHaveCount(0);
  await expect(page.getByTestId("map-action-escape")).toHaveCount(0);
});

test("weather and telemetry distinguish valid zero from missing data", async ({ page }) => {
  const now = Date.now();
  const validZero = telemetryFixture({
    wind: { speedMph: 0, gustMph: 0, directionDeg: 0, directionCardinal: "N", source: "vehicle", updatedAt: now },
    weather: {
      tempF: 0,
      dewpointF: 0,
      humidity: 0,
      pressureMb: 1000,
      pressureTrend: "steady",
      rainRateInHr: 0,
      rainTotalIn: 0,
      source: "vehicle",
      sourceLabel: "VEHICLE",
      updatedAt: now,
    },
    gps: {
      speedMph: 0,
      headingDeg: null,
      headingCardinal: "--",
      elevationFt: 0,
      accuracyM: 5,
      hdop: null,
      satellites: 8,
      hasFix: true,
      lat: 36.1867,
      lon: -94.1288,
      source: "tablet",
      updatedAt: now,
    },
    power: { mainBatteryV: 0, auxBatteryV: 0, charging: false, source: "vehicle", updatedAt: now },
    system: { cpuPercent: 0, ramPercent: 0, storagePercent: 0, uptimeSeconds: 0, source: "vehicle", updatedAt: now },
  });
  await injectTelemetry(page, validZero);
  const weather = await goToRoute(page, "weather");
  await expect(weather.locator(".metric-tile--temp strong").first()).toHaveText("0");
  await expect(weather.locator(".metric-tile--dp strong, .metric-tile--dew strong").first()).toHaveText("0");
  await expect(weather.locator(".wind-hero__item--speed strong").first()).toHaveText("0");
  await expect(weather.locator(".metric-tile--heading strong").first()).toHaveText("--");

  const ops = await goToRoute(page, "operations");
  await expect(ops.locator(".ops-power-panel")).toContainText(/Main Batt\s*0\.00V/i);
  await expect(ops.locator(".ops-system-panel")).toContainText(/CPU\s*0%/i);

  await page.goto("/");
  await page.locator(".cb-splash").waitFor({ state: "hidden", timeout: 12_000 }).catch(() => undefined);
  await dismissSpotterPrompt(page);
  await injectTelemetry(page, telemetryFixture());
  const missingWeather = await activeRoute(page, "weather");
  await expect(missingWeather.locator(".metric-tile--temp strong").first()).toHaveText("--");
  await expect(missingWeather.locator(".metric-tile--dp strong, .metric-tile--dew strong").first()).toHaveText("--");
  await expect(missingWeather.locator(".wind-hero__item--speed strong").first()).toHaveText("--");
  await expect(missingWeather).toContainText(/SOURCE UNAVAILABLE|NO TRUSTED WIND|NO GPS FIX/i);

  await goToRoute(page, "operations");
  const missingOps = await activeRoute(page, "operations");
  await expect(missingOps.locator(".ops-power-panel")).toContainText(/NO DATA EVER RECEIVED/i);
  await expect(missingOps.locator(".ops-power-panel")).toContainText(/Main Batt\s*--/i);
  await expect(missingOps.locator(".ops-system-panel")).toContainText(/CPU\s*--/i);
});

test("secondary routes remain under More instead of primary phone navigation", async ({ page }) => {
  const dockText = await page.getByRole("navigation", { name: /dashboard dock/i }).innerText();
  expect(dockText).toMatch(/\bHome\b/i);
  expect(dockText).toMatch(/\bMap\b/i);
  expect(dockText).toMatch(/\bMore\b/i);
  expect(dockText).not.toMatch(/\bLocate\b/i);
  expect(dockText).not.toMatch(/\bOperations\b/i);
  expect(dockText).not.toMatch(/\bReport\b/i);
  expect(dockText).not.toMatch(/\bSettings\b/i);
  expect(dockText).not.toMatch(/\bLayers\b/i);
  expect(dockText).not.toMatch(/\bAI\b/i);
  expect(dockText).not.toMatch(/\bFleet\b/i);
  expect(dockText).not.toMatch(/\bSystem\b/i);
});
