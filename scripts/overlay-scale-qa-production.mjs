// Pass F (production mode): confirms the dev=0 real-OBS render actually fills each target
// canvas exactly (fit scaling up past 1080p, not capped) and carries zero dev-only chrome
// (opaque dev-shell fill, stray border/shadow/radius) that would otherwise fight the video.
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

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = {};

  for (const target of TARGETS) {
    const page = await browser.newPage({ viewport: { width: target.width, height: target.height } });
    await page.goto(`${baseUrl}?dev=0&bg=transparent`, { waitUntil: "networkidle" });
    await page.waitForSelector(".command-rail");
    await page.waitForTimeout(200);

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".dev-shell");
      const frame = document.querySelector(".stage-frame").getBoundingClientRect();
      const shellStyle = getComputedStyle(shell);
      const frameStyle = getComputedStyle(document.querySelector(".stage-frame"));
      return {
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        frameW: +frame.width.toFixed(1),
        frameH: +frame.height.toFixed(1),
        fillsViewportExactly: Math.abs(frame.width - window.innerWidth) < 1 && Math.abs(frame.height - window.innerHeight) < 1,
        devShellBackground: shellStyle.backgroundColor,
        devShellPadding: shellStyle.padding,
        frameBoxShadow: frameStyle.boxShadow,
        frameBorderRadius: frameStyle.borderRadius,
        devPanelPresent: !!document.querySelector(".dev-panel"),
      };
    });
    report[target.name] = metrics;

    await page.screenshot({ path: path.join(outDir, `production-${target.name}.png`) });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
