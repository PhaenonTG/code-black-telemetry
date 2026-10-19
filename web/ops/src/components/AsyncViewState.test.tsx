import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AsyncViewState } from "./AsyncViewState"

describe("AsyncViewState", () => {
  it.each(["loading", "stale", "error", "empty"] as const)("renders the %s state with its label", (state) => {
    const html = renderToString(<AsyncViewState state={state} title="Inventory" message="Detail" />)
    expect(html).toContain(`data-state="${state}"`)
    expect(html).toContain({ loading: "Waiting", stale: "Stale", error: "Unavailable", empty: "0" }[state])
    expect(html).toContain("Inventory")
    expect(html).toContain("Detail")
  })

  it("uses alert semantics only for errors", () => {
    expect(renderToString(<AsyncViewState state="error" />)).toContain('role="alert"')
    expect(renderToString(<AsyncViewState state="loading" />)).toContain('role="status"')
    expect(renderToString(<AsyncViewState state="stale" />)).toContain('role="status"')
  })

  it("never shows a last-updated time unless one is supplied", () => {
    for (const state of ["loading", "stale", "error", "empty"] as const) {
      const html = renderToString(<AsyncViewState state={state} />)
      expect(html).not.toContain("Last updated")
      expect(html).not.toContain("<time")
    }
  })

  it("shows the supplied last-updated time as an ISO datetime", () => {
    const at = new Date("2026-10-18T15:00:00.000Z")
    const html = renderToString(<AsyncViewState state="stale" lastUpdated={at} />)
    expect(html).toContain("Last updated")
    expect(html).toContain('dateTime="2026-10-18T15:00:00.000Z"')
  })

  it("ignores an invalid last-updated date instead of rendering Invalid Date", () => {
    const html = renderToString(<AsyncViewState state="stale" lastUpdated={new Date("not a date")} />)
    expect(html).not.toContain("Last updated")
    expect(html).not.toContain("Invalid Date")
    expect(renderToString(<AsyncViewState state="stale" lastUpdated={null} />)).not.toContain("Last updated")
    expect(renderToString(<AsyncViewState state="stale" lastUpdated={undefined} />)).not.toContain("Last updated")
  })

  it("renders a retry button only when a retry handler is provided", () => {
    expect(renderToString(<AsyncViewState state="error" />)).not.toContain("<button")
    const html = renderToString(<AsyncViewState state="error" onRetry={() => {}} retryLabel="Retry now" />)
    expect(html).toContain("<button")
    expect(html).toContain("Retry now")
  })

  it("shows a caller-provided timeout hint and children", () => {
    const html = renderToString(<AsyncViewState state="loading" timeoutHint="Can take up to 90s"><span>extra</span></AsyncViewState>)
    expect(html).toContain("Can take up to 90s")
    expect(html).toContain("<span>extra</span>")
  })
})
