import { chromium } from "playwright";
const base = process.env.TROPICS_BASE_URL || "https://tropics.codeblackwx.com";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  for (const viewport of [{ width: 390, height: 844, label: "mobile" }, { width: 1280, height: 800, label: "desktop" }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(`${message.text()} ${message.location().url}`); });
    page.on("response", response => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) errors.push(`${response.status()} ${response.url()}`); });
    const response = await page.goto(`${base}/storms/ep182026`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: /Rachel/i }).waitFor({ timeout: 20_000 });
    await page.locator(".system-map .mapboxgl-canvas").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `C:/Users/glenn/AppData/Local/Temp/tropics-rachel-${viewport.label}.png`, fullPage: true });
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      title: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim(),
      mapCanvas: Boolean(document.querySelector(".system-map canvas")),
      official: Boolean(document.querySelector("a.system-header__nhc")),
      experimental: document.body.textContent?.includes("Not an official forecast"),
    }));
    const guidance = page.locator("details").filter({ has: page.locator("summary", { hasText: "MODEL GUIDANCE" }) });
    await guidance.locator("summary").click();
    await guidance.locator("input[type=checkbox]").first().check();
    const modelToggled = (await guidance.locator("input[type=checkbox]").first().isChecked()) && await page.locator(".system-legend").getByText("MODELS").count() > 0;
    console.log(JSON.stringify({ viewport: viewport.label, http: response?.status(), ...metrics, modelToggled, errors }));
    if (response?.status() !== 200 || metrics.scrollWidth > metrics.viewportWidth || !metrics.mapCanvas || !metrics.official || !metrics.experimental || !modelToggled || errors.length) process.exitCode = 1;
    await page.close();
  }
  const source = await (await fetch("https://ops.codeblackwx.com/api/public/tropical-systems/ep182026")).json();
  const reviewed = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await reviewed.route(/\/api\/(?:public\/)?tropical-systems\/ep182026$/, route => route.fulfill({ json: {
    ...source, analysis: { status: "ready", reviewed_at: "2026-10-10T07:30:00Z", confidence: "moderate",
      summary: "The official forecast remains the primary track. Current model guidance supports a nearby experimental center path, with structure and intensity still sensitive to the environment.",
      track_assessment: "Official guidance and dynamical aids remain broadly aligned.",
      intensity_assessment: "The NHC intensity remains the observed reference.",
      changes: ["NHC wind is unchanged since the previous source check."],
      uncertainties: ["Later track spread remains meaningful."], next_check: ["Review the next NHC advisory."],
      evidence: [{ source: "nhc_track", finding: "The official track remains the forecast reference." }] },
    prior_reviews: [{ status: "ready", reviewed_at: "2026-10-10T01:30:00Z", basis_nhc_updated_at: "2026-10-10T01:00:00Z",
      summary: "Earlier guidance showed a different position before the latest advisory.",
      track_assessment: "Earlier track assessment.", intensity_assessment: "Earlier intensity assessment.",
      changes: ["The earlier source check reported a shift."] }]
  } }));
  await reviewed.goto(`${base}/storms/ep182026`, { waitUntil: "domcontentloaded" });
  await reviewed.getByText("The official forecast remains the primary track.", { exact: false }).waitFor();
  await reviewed.locator(".system-review__archive > summary").click();
  await reviewed.getByText("1 ARCHIVED").waitFor();
  await reviewed.locator(".system-review__archive li details > summary").first().click();
  await reviewed.getByText("Earlier guidance showed a different position", { exact: false }).waitFor();
  await reviewed.screenshot({ path: "C:/Users/glenn/AppData/Local/Temp/tropics-review-history-mobile.png", fullPage: true });
  const reviewOverflow = await reviewed.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log(JSON.stringify({ reviewedMobile: true, reviewOverflow }));
  if (reviewOverflow) process.exitCode = 1;
  await reviewed.close();
  const isaias = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await isaias.goto(`${base}/storms/al092026`, { waitUntil: "domcontentloaded" });
  await isaias.getByRole("heading", { name: /Post-tropical cyclone\s*Isaias/i }).waitFor();
  const isaiasOverflow = await isaias.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log(JSON.stringify({ postTropicalLabel: true, isaiasOverflow }));
  if (isaiasOverflow) process.exitCode = 1;
  await isaias.close();
  const desk = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await desk.goto(`${base}/#basin-watch`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await desk.locator("#basin-watch details").waitFor({ timeout: 20_000 });
  await desk.getByRole("link", { name: /Tropical storm Rachel/i }).waitFor({ timeout: 20_000 });
  const basinOpen = await desk.locator("#basin-watch details").evaluate(element => element.open);
  const rachelLink = await desk.getByRole("link", { name: /Tropical storm Rachel/i }).getAttribute("href");
  console.log(JSON.stringify({ basinOpen, rachelLink }));
  if (!basinOpen || rachelLink !== "/storms/ep182026") process.exitCode = 1;
  await desk.close();
} finally {
  await browser.close();
}
