import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { OutlookMap } from './OutlookMap'
import { mapShape } from './outlookGeometry'

it.each([false, true])('keeps the outlook map a native-scroll SVG when expanded=%s', expanded => {
  const html = renderToString(<OutlookMap day={1} regions={[]} shape={mapShape('conus')} coverage="conus" onCoverage={() => {}} expanded={expanded} onExpand={() => {}} expandButton={{ current: null }} onSelect={() => {}} />)
  expect(html).toContain('<svg')
  expect(html).toContain('state boundaries and selected outlook areas')
  expect(html).toContain(expanded ? 'Collapse map' : 'Expand map')
  expect(html).toContain(`aria-expanded="${expanded}"`)
  expect(html).not.toMatch(/<canvas|mapboxgl|maplibregl|touch-action/)
})

it('does not capture touch drags or suppress native scroll and pinch in either outlook size', () => {
  // Expansion reuses this SVG; details is a sibling, not a hidden WebGL map.
  const catalog = readFileSync(new URL('./HorizonCatalog.tsx', import.meta.url), 'utf8')
  expect(catalog).toContain('<OutlookMap')
  expect(catalog).toContain('expanded={expanded}')
  const sources = ['OutlookMap.tsx', 'OutlookDetails.tsx', 'HorizonCatalog.tsx'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
  expect(sources).not.toMatch(/mapbox-gl|maplibre|onTouch\w*|onPointer\w*|onWheel|addEventListener\(['"](?:touch|pointer|wheel)/)
  const css = readFileSync(new URL('./horizons.css', import.meta.url), 'utf8')
  expect(css).not.toMatch(/touch-action\s*:|overscroll-behavior\s*:/)
})
