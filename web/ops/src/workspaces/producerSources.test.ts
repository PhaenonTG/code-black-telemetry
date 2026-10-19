import { describe, expect, it } from "vitest"
import { chooseProducerSource, parseProducerSources } from "./producerSources"

describe("producer live sources", () => {
  it("only creates known private live-stream player links", () => {
    const sources = parseProducerSources({ sources: [
      { id: "STRIKER", name: "STRIKER", state: "LIVE", publisher_online: true, readers: 2 },
      { id: "road-camera", name: "Road camera", state: "LIVE", publisher_online: true, stream_url: "https://example.com/road" },
    ] })
    expect(sources[0].playerUrl).toBe("https://codeblack-core.tail1d0673.ts.net/mtx/spencer/")
    expect(sources[1].playerUrl).toBeNull()
  })

  it("keeps a manual selection even when another source becomes live", () => {
    const sources = parseProducerSources({ sources: [
      { id: "STRIKER", name: "STRIKER", publisher_online: true },
      { id: "TESSA", name: "TESSA", publisher_online: false },
    ] })
    expect(chooseProducerSource(sources, "TESSA")?.id).toBe("TESSA")
    expect(chooseProducerSource(sources, "")?.id).toBe("STRIKER")
  })

  it("rejects malformed source records", () => {
    expect(parseProducerSources({ sources: [null, { id: "X" }, { name: "X" }] })).toEqual([])
  })
})
