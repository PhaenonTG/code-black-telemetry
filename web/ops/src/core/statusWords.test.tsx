import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { STATUS_WORDS, statusWord } from "./statusWords"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { StatusBadge } from "../components/StatusBadge"

const legacy = {
  READY: "Live", LIVE: "Live", CONNECTED: "Live", CURRENT: "Live", OPEN: "Live", ONLINE: "Live", OK: "Live", PUBLISHING: "Live",
  AGING: "Stale", STALE: "Stale", DEGRADED: "Stale",
  OFFLINE: "Offline", ERROR: "Offline", CLOSED: "Offline",
  UNAVAILABLE: "Unavailable", NOT_CONFIGURED: "Unavailable", DISABLED: "Unavailable", NO_DATA: "Unavailable", OUTSIDE_COVERAGE: "Unavailable",
  CHECKING: "Waiting", STANDBY: "Waiting", PENDING: "Waiting", WAITING: "Waiting", CONNECTING: "Waiting", UNKNOWN: "Waiting", "Unknown, no report": "Waiting",
}
describe("shared status vocabulary", () => {
  it.each(Object.entries(legacy))("renders legacy %s as %s in both pills", (state, word) => {
    expect(statusWord(state)).toBe(word)
    for (const html of [renderToString(<OpsStatusPill state={state} />), renderToString(<StatusBadge state={state} />)]) {
      expect(html).toContain(`>${word}</span>`)
      expect(html).toContain(STATUS_WORDS[word as keyof typeof STATUS_WORDS].color)
    }
  })
  it("preserves development pills and renders empty as a real zero", () => {
    for (const Component of [OpsStatusPill, StatusBadge]) {
      expect(renderToString(<Component state="DEVELOPMENT" />)).toContain("DEVELOPMENT")
      expect(renderToString(<Component state="EMPTY" />)).toContain(">0</span>")
    }
  })
  it("keeps forecast content in the same list as a separate kind", () => {
    expect(Object.values(STATUS_WORDS).filter(word => word.kind === "forecast")).toHaveLength(5)
    expect(Object.values(STATUS_WORDS).filter(word => word.kind === "status")).toHaveLength(5)
    for (const word of Object.keys(STATUS_WORDS)) expect(statusWord(word.toUpperCase())).toBe(word)
  })
  it("uses red for Offline and steel for missing data", () => {
    expect(STATUS_WORDS.Offline.color).toBe("var(--cb-red)")
    expect(statusWord(undefined)).toBe("Unavailable")
  })
})
