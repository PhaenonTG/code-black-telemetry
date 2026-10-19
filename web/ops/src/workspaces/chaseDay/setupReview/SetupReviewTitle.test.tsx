import { renderToString } from "react-dom/server"
import { expect, it } from "vitest"
import { SetupReviewTime, SetupReviewTitle } from "./SetupReviewTitle"
it("uses shared Title Case state, a single Refresh, checked time and UTC only on hover", () => {
  const html = renderToString(<SetupReviewTitle title="Potential" description="Experimental; this is not an all-clear." state="DEGRADED" checkedAt="2026-11-02T16:30:00Z" busy refresh={() => {}} reloads="model grids" />)
  expect(html).toContain("Stale")
  expect(html).toContain("10:30 AM CST")
  expect(html).toContain('title="2026-11-02T16:30:00.000Z"')
  expect(html).toContain('title="Refresh model grids"')
  expect(html).toContain('aria-label="Waiting for refresh"')
  expect(html.match(/>Refresh<\/button>/g)).toHaveLength(1)
})
it("derives DST labels for evidence timestamps and renders missing time as a dash", () => {
  expect(renderToString(<SetupReviewTime value="2026-10-19T15:30:00Z" />)).toContain("10:30 AM CDT")
  expect(renderToString(<SetupReviewTime value="2026-11-02T16:30:00Z" />)).toContain("10:30 AM CST")
  expect(renderToString(<SetupReviewTime />)).toBe("—")
})
