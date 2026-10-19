import { defineConfig, devices } from "@playwright/test";

const artifactRoot = "artifacts/rendered-control-walkthrough";

export default defineConfig({
  testDir: "./tests/walkthrough",
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactRoot}/playwright-report.json` }],
    ["html", { outputFolder: `${artifactRoot}/html`, open: "never" }],
  ],
  outputDir: `${artifactRoot}/test-results`,
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "phone-portrait",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2.75,
      },
    },
    {
      name: "tablet-landscape",
      use: {
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 920 },
      },
    },
  ],
});
