// Pass F: render the LIVE app at real target OBS canvas resolutions (native browser layout,
// not a stretched screenshot of the 1080p capture) and record the actual composition metrics.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "artifacts/overlay-brand-redesign-v1/scale-check";
const baseUrl = process.argv[3] ?? "http://127.0.0.1:5176/";
mkdirSync(outDir, { recursive: true });

const TARGETS = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4k", width: 3840, height: 2160 },
];

async function setSelect(page, label, value) {
  const select = page.locator(".dev-panel__row", { hasText: label }).locator("select");
  await select.selectOption(value);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = {};

  for (const target of TARGETS) {
    const page = await browser.newPage({ viewport: { width: target.width, height: target.height } });
    await page.goto(`${baseUrl}?dev=1`, { waitUntil: "networkidle" });
    await page.waitForSelector(".dev-panel");
    await setSelect(page, "Scenario", "severe_supercell");
    await page.getByRole("button", { name: "TOR WARNING" }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.querySelector(".dev-panel").style.display = "none";
    });
    await page.waitForTimeout(100);

    const metrics = await page.evaluate(() => {
      const frame = document.querySelector(".stage-frame").getBoundingClientRect();
      const rail = document.querySelector(".command-rail").getBoundingClientRect();
      const bug = document.querySelector(".brand-bug").getBoundingClientRect();
      const takeover = document.querySelector(".takeover__inner").getBoundingClientRect();
      const headline = getComputedStyle(document.querySelector(".takeover__headline")).fontSize;
      const cityFont = getComputedStyle(document.querySelector(".rail-identity__city")).fontSize;
      const clipSize = getComputedStyle(document.documentElement).getPropertyValue("--cb-clip-size");
      return {
        frameW: frame.width,
        frameH: frame.height,
        aspectRatio: +(frame.width / frame.height).toFixed(4),
        railHeightPctOfFrame: +((rail.height / frame.height) * 100).toFixed(2),
        railWidthPctOfFrame: +((rail.width / frame.width) * 100).toFixed(2),
        bugHeightPx: +bug.height.toFixed(1),
        bugHeightPctOfFrame: +((bug.height / frame.height) * 100).toFixed(2),
        takeoverWidthPctOfFrame: +((takeover.width / frame.width) * 100).toFixed(2),
        takeoverHeadlineFontPx: headline,
        cityFontPx: cityFont,
        clipSizeCssValue: clipSize,
        videoSafeAreaPct: +(100 - (rail.height / frame.height) * 100).toFixed(2),
      };
    });
    report[target.name] = metrics;

    const box = await page.locator(".stage-frame").boundingBox();
    await page.screenshot({ path: path.join(outDir, `${target.name}.png`), clip: box });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
