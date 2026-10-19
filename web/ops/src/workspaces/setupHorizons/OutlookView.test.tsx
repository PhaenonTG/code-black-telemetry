import {renderToString} from 'react-dom/server'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {HorizonCatalogView} from './HorizonCatalog'
import {OutlookDayStrip} from './OutlookDayStrip'
import {OutlookDetails,EvidenceHistory} from './OutlookDetails'
import {OutlookMap} from './OutlookMap'
import {mapShape} from './outlookGeometry'
import type {Catalog,Region} from './outlookModel'
vi.mock('../../core/client',()=>({fetchForecast:vi.fn()}))
const now=Date.parse('2026-11-02T18:00:00Z')
const source={day:1,status:'available',valid_from:'2026-11-02T12:00:00Z',valid_until:'2026-11-03T12:00:00Z',issued_at:'2026-11-02T11:00:00Z'}
const region=(label:string,official_code:number):Region=>({catalog_id:label,day:1,kind:'official',label,official_code,source:'NOAA SPC',source_url:'https://example.invalid/evidence',issued_at:source.issued_at,valid_from:source.valid_from,valid_until:source.valid_until,data_status:'retained',uncertainty:'Operator review required.',geometry:{type:'Polygon',coordinates:[[[-100,35],[-96,38],[-92,35],[-100,35]]]}})
const catalog:Catalog={schema:'codeblack.chase.horizon-catalog.v1',checked_at:'2026-11-02T17:59:00Z',revision:7,cache_state:'available',acquisition_note:'Saved evidence.',records:[region('High',8),region('Moderate',6),region('Thunderstorms',2)],sources:[source],history:[]}
afterEach(()=>vi.useRealTimers())
describe('Outlook read-only carry-over',()=>{
 it('sorts low to high and keeps origins, source details, controls and safety text',()=>{
  vi.useFakeTimers();vi.setSystemTime(now)
  const html=renderToString(<HorizonCatalogView catalog={catalog} error={null} onRefresh={()=>{}}/>)
  const groups=[...html.matchAll(/class="outlook-area"/g)]
  expect(groups).toHaveLength(3)
  expect(html.indexOf('title>Thunderstorms')).toBeLessThan(html.indexOf('title>Moderate'))
  expect(html.indexOf('title>Moderate')).toBeLessThan(html.indexOf('title>High'))
  for(const text of ['Refresh','Reload the saved outlook snapshot','Expand map','Alaska','Hawaii','Planning origins','Reset town defaults','Session-local only','Open original source','Evidence history','Source checked','Retained data state','this is not an all-clear','CST'])expect(html).toContain(text)
  expect(html).not.toContain('Refresh saved snapshot')
  expect(html).not.toContain('No replacement forecast is invented. Saved')
 })
 it('shows one error banner without revision-zero evidence or placeholder detail chips',()=>{
  const html=renderToString(<HorizonCatalogView catalog={null} error="UNAVAILABLE" onRefresh={()=>{}}/>)
  expect(html).toContain('Saved outlook unavailable')
  expect(html).toContain('Retry')
  expect(html).not.toContain('Evidence history')
  expect(html).not.toContain('Selected source details')
  expect(html).not.toContain('Loading saved official-source')
  expect(html).toContain('Planning origins')
 })
 it('keeps all fourteen day controls with dates, groups, full labels and valid-window tooltips',()=>{
  const html=renderToString(<OutlookDayStrip catalog={catalog} day={9} onDay={()=>{}} now={now}/>)
  expect(html.match(/aria-pressed=/g)).toHaveLength(14)
  expect(html).toContain('OFFICIAL');expect(html).toContain('SPECULATIVE')
  expect(html).toContain('Day 14, Unavailable, Sun, Nov 15')
  expect(html).not.toContain('Unavail.')
 })
 it('shows Expired instead of Available and preserves human and raw source links',()=>{
  const html=renderToString(<OutlookDetails day={1} source={source} row={catalog.records[0]} rows={catalog.records} catalog={catalog} onSelect={()=>{}} now={Date.parse(source.valid_until)}/>)
  expect(html).toContain('Expired');expect(html).not.toContain('>Available<')
  expect(html).toContain('High Risk (5 of 5)')
  expect(html).toContain('day1otlk.html');expect(html).toContain('example.invalid/evidence')
  expect(renderToString(<EvidenceHistory catalog={catalog}/>).replace(/<!-- -->/g,'')).toContain('rev 7')
 })
 it.each(['alaska','hawaii'])('keeps %s boundaries with a CONUS switch and explicit coverage state',(coverage)=>{
  const html=renderToString(<OutlookMap day={1} source={source} regions={[]} shape={mapShape(coverage)} coverage={coverage} onCoverage={()=>{}} expanded={true} onExpand={()=>{}} expandButton={{current:null}} onSelect={()=>{}}/>)
  expect(html).toContain('Collapse map');expect(html).toContain('No outlook areas here')
  expect(html).toContain('SPC covers the contiguous US only.')
  expect(html).toContain('Switch to Contiguous US')
  expect(html).toContain('setup-horizons__state')
 })
})
