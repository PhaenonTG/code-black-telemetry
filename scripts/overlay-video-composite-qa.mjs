// Pass D: composite the overlay chassis over representative lighting conditions.
// No real Code Black storm footage exists locally on this machine, so per the documented
// fallback these are temporary SYNTHETIC CSS-gradient fixtures standing in for real video --
// injected at runtime only, never written into web/overlay/src or any production asset.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "artifacts/overlay-brand-redesign-v1/video-composite";
const baseUrl = process.argv[3] ?? "http://127.0.0.1:5176/";
mkdirSync(outDir, { recursive: true });

const FIXTURES = {
  "bright-sky": "linear-gradient(180deg, #cfe0ea 0%, #9fb6c4 40%, #7c8892 70%, #55606a 100%)",
  "storm-base":
    "radial-gradient(120% 90% at 30% 10%, rgba(90,70,60,0.35), transparent 55%), linear-gradient(180deg, #2b2f37 0%, #1c2027 35%, #14171c 65%, #0c0e11 100%)",
  "rain-wrapped":
    "repeating-linear-gradient(100deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 7px), linear-gradient(180deg, #3a4048 0%, #23272c 50%, #14171a 100%)",
  "night-roadway": "linear-gradient(180deg, #0b0c0e 0%, #16181b 50%, #26282b 50.5%, #1a1b1d 100%)",
  "lightning-flash":
    "radial-gradient(60% 50% at 50% 28%, rgba(255,255,255,0.92), rgba(200,210,230,0.35) 40%, transparent 70%), linear-gradient(180deg, #1c1f24 0%, #0b0d0f 100%)",
};

const CASES = [
  { fixture: "bright-sky", scenario: "severe_supercell", takeover: null, name: "bright-sky_normal" },
  { fixture: "bright-sky", scenario: "severe_supercell", takeover: "TOR WARNING", name: "bright-sky_tor-warning" },
  { fixture: "storm-base", scenario: "severe_supercell", takeover: null, name: "storm-base_normal" },
  { fixture: "rain-wrapped", scenario: "severe_supercell", takeover: "SVR WARNING", name: "rain-wrapped_svr-warning" },
  { fixture: "night-roadway", scenario: "severe_supercell", takeover: null, name: "night-roadway_normal" },
  {
    fixture: "lightning-flash",
    scenario: "high_end_tornadic",
    takeover: "TOR WARNING",
    name: "lightning-flash_tor-warning",
  },
];

async function setSelect(page, label, value) {
  const select = page.locator(".dev-panel__row", { hasText: label }).locator("select");
  await select.selectOption(value);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1968, height: 1128 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".dev-panel");

  for (const c of CASES) {
    await page.evaluate((el) => {
      const dp = document.querySelector(".dev-panel");
      if (dp) dp.style.display = "";
    });
    const dismiss = page.locator(".dev-panel__dismiss");
    if (await dismiss.count()) await dismiss.click();
    await setSelect(page, "Scenario", c.scenario);
    await page.evaluate((bg) => {
      const frame = document.querySelector(".stage-frame");
      frame.style.background = bg;
    }, FIXTURES[c.fixture]);
    if (c.takeover) {
      await page.getByRole("button", { name: c.takeover }).click();
      await page.waitForTimeout(300);
    } else {
      await page.waitForTimeout(150);
    }
    await page.evaluate(() => {
      const dp = document.querySelector(".dev-panel");
      if (dp) dp.style.display = "none";
    });
    await page.waitForTimeout(100);
    const frame = page.locator(".stage-frame");
    const box = await frame.boundingBox();
    await page.screenshot({ path: path.join(outDir, `${c.name}.png`), clip: box });
    console.log("captured", c.name);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
