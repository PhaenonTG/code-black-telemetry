import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
it("reserves the potential/outlook async footprint without exposing retained hidden tabs", () => {
  const css = readFileSync(new URL("./Workspaces.css", import.meta.url), "utf8")
  expect(css).toMatch(/\.analysis-tab-panel\[data-tab="outlook"\],\s*\.analysis-tab-panel\[data-tab="potential"\]\s*\{ min-height: 36rem; \}/)
  expect(css).toMatch(/\.analysis-tab-panel\[hidden\]\s*\{ display:none; \}/)
  expect(css).not.toMatch(/analysis-tab-panel[^}]*height:\s*\d+px[^}]*overflow:\s*hidden/)
})
it("reserves Aegis plan, feed, evidence and review space across loading and ready states", () => {
  const css = readFileSync(new URL("../styles/aegis.css", import.meta.url), "utf8")
  expect(css).toContain('.aegis-page .aegis-observation { min-height: 18rem; }')
  expect(css).toContain('.aegis-page .aegis-grid > .aegis-panel { min-height: 28rem; }')
  expect(css).toContain('.aegis-page .aegis-review { min-height: 24rem; }')
  expect(css).toMatch(/@media \(max-width: 850px\)\s*\{\s*\.aegis-page \.aegis-observation \{ min-height: 24rem; \}/)
  expect(css).toContain('.aegis-page .aegis-grid > .aegis-panel { min-height: 32rem; }')
})
