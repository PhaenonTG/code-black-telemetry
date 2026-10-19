// Throwaway QA capture script for the web/overlay brand-redesign pass.
// Usage: node scripts/overlay-screenshot.mjs <outDir> <baseUrl>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "artifacts/overlay-brand-redesign-v1/before";
const baseUrl = process.argv[3] ?? "http://127.0.0.1:5176/";
mkdirSync(outDir, { recursive: true });

const STAGE_W = 1920;
const STAGE_H = 1080;

async function setSelect(page, label, value) {
  const select = page.locator(".dev-panel__row", { hasText: label }).locator("select");
  await select.selectOption(value);
}

async function hidePanelAndScreenshot(page, filename) {
  await page.evaluate(() => {
    const el = document.querySelector(".dev-panel");
    if (el) el.style.display = "none";
  });
  await page.waitForTimeout(150);
  const frame = page.locator(".stage-frame");
  const box = await frame.boundingBox();
  await page.screenshot({ path: path.join(outDir, filename), clip: box });
  await page.evaluate(() => {
    const el = document.querySelector(".dev-panel");
    if (el) el.style.display = "";
  });
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: STAGE_W + 48, height: STAGE_H + 48 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".dev-panel");

  const shots = [
    { name: "01-normal-persistent", scenario: "low_end", bg: "storm", takeover: null },
    { name: "02-severe-supercell", scenario: "severe_supercell", bg: "storm", takeover: null },
    { name: "03-high-end-tornadic", scenario: "high_end_tornadic", bg: "storm", takeover: null },
    { name: "04-hodograph-context", scenario: "severe_supercell", bg: "storm", takeover: null },
    { name: "05-tornado-warning-takeover", scenario: "severe_supercell", bg: "storm", takeover: "TOR WARNING" },
    { name: "06-stale-data", scenario: "stale_data", bg: "storm", takeover: null },
    { name: "07-partial-data", scenario: "partial_data", bg: "storm", takeover: null },
    { name: "08-provider-failure", scenario: "provider_failure", bg: "storm", takeover: null },
    { name: "09-transparent-obs", scenario: "severe_supercell", bg: "transparent", takeover: null },
  ];

  for (const shot of shots) {
    if (shot.takeover) {
      await page.evaluate(() => {
        const el = document.querySelector(".dev-panel");
        if (el) el.style.display = "";
      });
      await setSelect(page, "Scenario", shot.scenario);
      await setSelect(page, "Background", shot.bg);
      await page.getByRole("button", { name: shot.takeover }).click();
      await page.waitForTimeout(300);
    } else {
      await page.evaluate(() => {
        const el = document.querySelector(".dev-panel");
        if (el) el.style.display = "";
      });
      const dismiss = page.locator(".dev-panel__dismiss");
      if (await dismiss.count()) await dismiss.click();
      await setSelect(page, "Scenario", shot.scenario);
      await setSelect(page, "Background", shot.bg);
      await page.waitForTimeout(200);
    }
    await hidePanelAndScreenshot(page, `${shot.name}.png`);
    console.log("captured", shot.name);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
