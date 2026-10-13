import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import AnalysisWorkspace from "./AnalysisWorkspace"
import ChaseSetups from "./ChaseSetups"
import ProducerControls from "../workspaces/ProducerControls"
import AegisAlerts from "./AegisAlerts"

vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: {} }) }))

describe("workspace polish preserves workflow boundaries", () => {
  it("keeps embedded surveillance compact without removing warning guidance", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AegisAlerts embedded /></MemoryRouter>)
    expect(html).not.toContain("<h1")
    expect(html).toContain("<h2>Radar surveillance</h2>")
    expect(html).toContain("Always follow official NWS warnings")
  })
  it("uses one page heading when drafts are embedded in Analysis", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/analysis/drafts"]}><AnalysisWorkspace /></MemoryRouter>)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain("<h2>Setup drafts</h2>")
    expect(html).toContain("No draft is public.")
    expect(html).toContain('aria-pressed="true">Drafts')
  })

  it("retains a standalone page heading and reviewed briefing identity", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ChaseSetups queue="briefings" /></MemoryRouter>)
    expect(html).toContain("<h1>Reviewed setup briefings</h1>")
    expect(html).toContain("Approved current revisions retained as private operational briefings.")
  })

  it("keeps optional metadata editable without hiding public action confirmations", () => {
    const html = renderToStaticMarkup(<ProducerControls />)
    expect(html).toContain('<details class="producer-controls__metadata"><summary>Broadcast title &amp; description</summary>')
    expect(html).toContain("Broadcast title<input")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Go Live on Facebook…<\/button>/)
    expect(html).toContain("STOP Facebook output")
    expect(html).toContain("Encoder SENDING does not prove the Facebook Page is public.")
  })
})
