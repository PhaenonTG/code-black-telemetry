import { expect, type Locator, type Page, test } from "@playwright/test";

const routes = [
  { key: "weather", dock: "dock-weather", route: "route-weather", path: "/", heading: /LOCATION & MOTION|WEATHER OBSERVATIONS/i },
  { key: "operations", dock: "dock-operations", route: "route-operations", path: "/operations", heading: /OPERATIONAL MODE/i },
  { key: "locate", dock: "dock-locate", route: "route-locate", path: "/locate", heading: /MOSAIC|LAYERS|FOLLOW/i },
  { key: "alerts", dock: "dock-alerts", route: "route-alerts", path: "/alerts", heading: /ACTIVE ALERTS|ALL ACTIVE PRODUCTS/i },
  { key: "report", dock: "dock-report", route: "route-report", path: "/report", heading: /SUBMIT REPORT|SPOTTER NETWORK/i },
  { key: "settings", dock: "dock-settings", route: "route-settings", path: "/settings", heading: /DISPLAY|LIVE OVERLAY TELEMETRY|CHASE SESSION/i },
  { key: "layers", dock: "dock-layers", route: "route-layers", path: "/layers", heading: /LAYER CONFIGURATION|CODE BLACK CHASER NET/i },
] as const;

const ignoredConsolePatterns = [
  /Download the React DevTools/i,
  /Mapbox GL JS/i,
  /Failed to load resource.*(api\.mapbox\.com|events\.mapbox\.com)/i,
  /GL Driver Message .*GPU stall due to ReadPixels/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /favicon/i,
];

const runtimeProblems = new WeakMap<Page, { consoleProblems: string[]; pageErrors: string[] }>();

function isIgnoredConsoleMessage(message: string) {
  return ignoredConsolePatterns.some((pattern) => pattern.test(message));
}

test.beforeEach(async ({ page }, testInfo) => {
  const consoleProblems: string[] = [];
  const pageErrors: string[] = [];
  runtimeProblems.set(page, { consoleProblems, pageErrors });

  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (!isIgnoredConsoleMessage(text)) consoleProblems.push(`${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText ?? "";
    if (/api\.mapbox\.com|events\.mapbox\.com|spotternetwork|weather\.gov/i.test(url)) return;
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
  await page.getByTestId(route.dock).click();
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

test.describe("rendered route walkthrough", () => {
  for (const route of routes) {
    test(`${route.key} route renders and keeps map-only actions scoped`, async ({ page }) => {
      const section = await goToRoute(page, route.key);
      await expectContainerHasArea(section, `${route.key} route`);
      await expectNoPageOverflow(page);

      if (route.key === "locate") {
        await expect(page.getByTestId("map-action-mark")).toBeVisible();
        await expect(page.getByTestId("map-action-escape")).toBeVisible();
      } else {
        await expect(page.getByTestId("map-action-mark")).toHaveCount(0);
        await expect(page.getByTestId("map-action-escape")).toHaveCount(0);
      }
    });
  }
});

test("locate map, layer popover, and expanded radar are wired", async ({ page }) => {
  const locate = await goToRoute(page, "locate");
  await expectContainerHasArea(locate.getByTestId("atlas-map-primary"), "primary map shell");
  await expectContainerHasArea(locate.getByTestId("atlas-map-canvas-primary"), "primary map canvas area");

  await locate.getByTestId("atlas-map-layers-primary").click();
  const layers = locate.getByTestId("atlas-map-layers-popover-primary");
  await expect(layers).toBeVisible();
  await expect(layers).toContainText(/Spotter Network/i);
  await expect(layers).toContainText(/Trail/i);
  await expect(layers).toContainText(/Road Conditions/i);
  await expect(layers).toContainText(/Public Cameras/i);
  await expect(layers).toContainText(/Probes - unavailable/i);
  await expect(layers).toContainText(/Chaser Net - unavailable/i);
  await locate.getByTestId("atlas-map-layers-primary").click();
  await expect(layers).toHaveCount(0);

  await locate.getByRole("button", { name: /expand radar/i }).click();
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

test("non-first-class routes remain out of primary navigation", async ({ page }) => {
  const dockText = await page.getByRole("navigation", { name: /dashboard dock/i }).innerText();
  expect(dockText).not.toMatch(/\bAI\b/i);
  expect(dockText).not.toMatch(/\bFleet\b/i);
  expect(dockText).not.toMatch(/\bSystem\b/i);
});
