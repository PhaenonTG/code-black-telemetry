import { expect, it } from "vitest"
import { renderToString } from "react-dom/server"
import { createAssessmentMemory } from "./assessmentMemory"
import { CachedAssessmentNotice } from "./CachedAssessmentNotice"
it("retains the last received assessment across route visits, scoped to the current provider", () => {
  const cache = createAssessmentMemory<{ advisory: string }>(), config = {}, otherConfig = {}
  expect(cache.read(config)).toBeUndefined()
  cache.remember(config, { advisory: "12" }, 1700000000000)
  expect(cache.read(config)).toEqual({ value: { advisory: "12" }, receivedAt: 1700000000000 })
  expect(cache.read(otherConfig)).toBeUndefined()
  cache.remember(config, { advisory: "13" }, 1700000060000)
  expect(cache.read(config)?.value.advisory).toBe("13")
})
it.each([true, false])("labels retained data with its actual receipt time (refreshing=%s)", refreshing => {
  const html = renderToString(<CachedAssessmentNotice receivedAt={1700000000000} refreshing={refreshing} />)
  expect(html).toContain("Cached assessment")
  expect(html).toContain('dateTime="2023-11-14T22:13:20.000Z"')
  expect(html).toContain(refreshing ? "Refreshing the latest assessment" : "Awaiting a successful refresh")
})
