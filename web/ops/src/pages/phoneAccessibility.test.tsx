import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import HurricaneWatch, { HurricaneMap } from "./HurricaneWatch"
import { PotentialMap } from "./TornadoPotential"
import { ChaseRadarPanel } from "../workspaces/ChaseRadarPanel"

const token = vi.hoisted(() => ({ available: true }))
vi.mock("../../../../src/services/mapTiles", () => ({
  hasMapboxToken: () => token.available,
  mapboxAccessToken: () => token.available ? "test-token" : "",
  atlasStyleUri: () => "test-style",
}))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: {} }) }))
vi.mock("../core/client", () => ({ fetchForecast: vi.fn() }))

afterEach(() => { token.available = true; vi.unstubAllGlobals() })

function expectInteractiveMap(html: string, className: string, description: string) {
  const map = html.match(new RegExp(`<div[^>]*class="${className}"[^>]*>`))?.[0]
  expect(map).toBeDefined()
  expect(map).not.toContain('role="img"')
  const descriptionId = map?.match(/aria-describedby="([^"]+)"/)?.[1]
  expect(descriptionId).toBeTruthy()
  expect(html).toContain(`id="${descriptionId}" class="a11y-caption">${description}</span>`)
}

describe("phone accessibility", () => {
  it("keeps hurricane controls outside an image role and retains a linked description", () => {
    const html = renderToString(<HurricaneMap data={{ status: "pending" }} registerCapture={vi.fn()} onRadarStatus={vi.fn()} onRadarVisible={vi.fn()} printMap={null} />)
    expectInteractiveMap(html, "hurricane-watch__map", "Current IEM NEXRAD radar mosaic, NHC cone, observed and forecast track, and Grand Bay watch location")
    expect(html).toContain('aria-pressed="true">Hide</button>')
  })

  it("describes the potential map without hiding injected controls from assistive technology", () => {
    expectInteractiveMap(renderToString(<PotentialMap data={null} stormOnly={false} />), "potential-map", "Independent Code Black HRRR tornado environment screening map")
  })

  it("retains the chase radar controls and product state with a linked map description", () => {
    const html = renderToString(<ChaseRadarPanel focus={null} />)
    expectInteractiveMap(html, "chase-radar__map", "REF radar from unavailable site")
    expect(html).toContain('aria-label="Radar product"')
    expect(html).toContain('aria-pressed="true">REF</button>')
  })

  it("keeps map descriptions unique when more than one instance is rendered", () => {
    const html = renderToString(<><PotentialMap data={null} stormOnly={false} /><PotentialMap data={null} stormOnly /></>)
    const ids = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it("uses the shared hurricane header and keeps Weather navigation without fetching during SSR", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const html = renderToString(<MemoryRouter><HurricaneWatch /></MemoryRouter>)
    expect(html).toContain('class="page-header hurricane-watch__header"')
    expect(html).toContain('class="page-header__kicker"')
    expect(html).toContain('<h1>Hurricane Watch</h1>')
    expect(html).toContain('class="page-header__description"')
    expect(html).toContain('href="/weather"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it("retains honest fallback messages when maps are not configured", () => {
    token.available = false
    expect(renderToString(<PotentialMap data={null} stormOnly={false} />)).toContain("Map token is unavailable")
    expect(renderToString(<ChaseRadarPanel focus={null} />)).toContain("Mapbox is not configured")
    const html = renderToString(<HurricaneMap data={{ status: "inactive", track: [{ hour: 0, latitude: 30, longitude: -90, wind_mph: 40 }], watch_point: { label: "Watch", latitude: 31, longitude: -89 } }} registerCapture={vi.fn()} onRadarStatus={vi.fn()} onRadarVisible={vi.fn()} printMap={null} />)
    expect(html).toContain('role="img" aria-label="Schematic forecast positions; live radar is unavailable without a map token"')
  })

  it("gives the selected radar product at least 4.5:1 text contrast", () => {
    const css = readFileSync(new URL("./Workspaces.css", import.meta.url), "utf8")
    const rule = css.match(/\.chase-radar__controls button\[aria-pressed=true\]\{([^}]+)\}/)?.[1] ?? ""
    const background = rule.match(/background:(#[a-f\d]{6});/i)?.[1]
    expect(background).toBeDefined()
    expect(rule).toContain("color:#fff")
    const channels = background!.slice(1).match(/../g)!.map(hex => parseInt(hex, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
  })
})
