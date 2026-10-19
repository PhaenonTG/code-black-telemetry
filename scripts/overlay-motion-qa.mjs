// Real motion QA for the Code Black WX overlay -- measures actual computed animation
// timing/iteration-count rather than eyeballing static screenshots.
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5176/";

async function computedAnim(page, selector) {
  return page.$eval(selector, (el) => {
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      duration: cs.animationDuration,
      iterationCount: cs.animationIterationCount,
    };
  });
}

async function noInfiniteAnimations(page, rootSelector) {
  return page.$$eval(`${rootSelector}, ${rootSelector} *`, (els) =>
    els
      .map((el) => ({ tag: el.className || el.tagName, ic: getComputedStyle(el).animationIterationCount }))
      .filter((r) => r.ic.split(", ").some((v) => v.trim() === "infinite")),
  );
}

async function setSelect(page, label, value) {
  const select = page.locator(".dev-panel__row", { hasText: label }).locator("select");
  await select.selectOption(value);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = {};

  // -- Normal-motion context --
  const page = await browser.newPage({ viewport: { width: 1968, height: 1128 } });
  const t0 = Date.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".command-rail");
  results.railRevealAtLoadMs = Date.now() - t0;
  results.railRevealAnim = await computedAnim(page, ".command-rail");
  results.hodoTraceAnim = await computedAnim(page, ".hodo-trace");

  results.infiniteInRailAtLoad = await noInfiniteAnimations(page, ".command-rail");

  // Featured metric rotation: capture label at t=0 and after one rotation interval.
  const firstLabel = await page.$eval(".fmb__featured .cb-label", (el) => el.textContent);
  await page.waitForTimeout(6300);
  const secondLabel = await page.$eval(".fmb__featured .cb-label", (el) => el.textContent);
  results.featuredRotation = { firstLabel, secondLabel, rotated: firstLabel !== secondLabel };

  // Tornado Warning takeover: entry timing, hold duration, auto-dismiss.
  await setSelect(page, "Scenario", "severe_supercell");
  const barBefore = Date.now();
  await page.getByRole("button", { name: "TOR WARNING" }).click();
  await page.waitForSelector(".takeover");
  results.takeoverEntryAnim = await computedAnim(page, ".takeover__inner");
  const barDuration = await page.$eval(".takeover__bar", (el) => getComputedStyle(el).animationDuration);
  results.takeoverBarDuration = barDuration;
  results.infiniteInTakeover = await noInfiniteAnimations(page, ".takeover");

  await page.waitForTimeout(9600); // TOR_WARNING holdMs = 9000ms
  const stillPresent = (await page.locator(".takeover").count()) > 0;
  results.takeoverAutoDismissedAfterMs = Date.now() - barBefore;
  results.takeoverStillPresentAfterHold = stillPresent;

  await page.close();

  // -- Reduced-motion context --
  const rmContext = await browser.newContext({ reducedMotion: "reduce" });
  const rmPage = await rmContext.newPage({ viewport: { width: 1968, height: 1128 } });
  await rmPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await rmPage.waitForSelector(".command-rail");
  results.reducedMotionRailAnim = await computedAnim(rmPage, ".command-rail");
  results.reducedMotionHodoAnim = await computedAnim(rmPage, ".hodo-trace");
  await rmContext.close();

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
