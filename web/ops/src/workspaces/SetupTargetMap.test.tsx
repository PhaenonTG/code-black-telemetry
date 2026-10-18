import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SetupTargetMap } from "./SetupTargetMap"
vi.mock("mapbox-gl", () => ({default:{}}))
vi.mock("../../../../src/services/mapTiles", () => ({hasMapboxToken:()=>true,atlasStyleUri:()=>"",mapboxAccessToken:()=>""}))
describe("Setup Review map accessibility", () => {
 it("describes the map without hiding its interactive controls behind an image role", () => {
  const html = renderToString(<SetupTargetMap geometry={null} bounds={undefined} points={[]}/>)
  const id = /<span id="([^"]+)" class="sr-only"/.exec(html)?.[1]
  expect(id).toBeTruthy()
  expect(html).toContain(`class="setup-target-map" aria-describedby="${id}"`)
  expect(html).toContain("Official SPC tornado outlook areas")
  expect(html).not.toContain('role="img"')
 })
})
