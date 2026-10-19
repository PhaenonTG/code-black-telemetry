import {describe,it,expect} from 'vitest'
import {contentState,dayDate,snapshotStale,sourceStale,date,sourceReason,originalSource,type Catalog} from './outlookModel'
export const NOW=Date.parse('2026-11-02T18:00:00Z')
export const catalog:Catalog={schema:'codeblack.chase.horizon-catalog.v1',checked_at:'2026-11-02T17:59:00Z',revision:7,cache_state:'available',acquisition_note:'Saved-source evidence.',records:[],sources:[{day:1,status:'available',valid_from:'2026-11-02T12:00:00Z',valid_until:'2026-11-03T12:00:00Z',issued_at:'2026-11-02T11:00:00Z'}],history:[]}
describe('Outlook validity and presentation',()=>{
 it('expires exactly at the validity deadline; stale and forecast content remain distinct',()=>{
  const source=catalog.sources[0]
  expect(contentState(source,undefined,Date.parse(source.valid_until!)-1)).toBe('Available')
  expect(contentState(source,undefined,Date.parse(source.valid_until!))).toBe('Expired')
  expect(snapshotStale(catalog,NOW)).toBe(false)
  expect(snapshotStale(catalog,Date.parse(catalog.checked_at!)+90*60000+1)).toBe(true)
  expect(snapshotStale({...catalog,cache_state:'STALE'},NOW)).toBe(true)
  expect(sourceStale({...source,checked_at:'2026-11-02T16:29:00Z'},NOW)).toBe(true)
  expect(sourceStale({...source,checked_at:'2026-11-02T17:59:00Z'},NOW)).toBe(false)
 })
 it('dates every missing day from the Day 1 validity anchor, without inventing a window',()=>{
  expect(date(dayDate(catalog,9))).toContain('Nov 10')
  expect(date(dayDate(catalog,14))).toContain('Nov 15')
  expect(dayDate(null,9)).toBeUndefined()
 })
 it('fixes day-specific missing-window copy and links to human SPC pages',()=>{
  for(const day of [9,14])expect(sourceReason('Official Day 8 validity window unavailable',day)).toBe(`Official Day ${day} validity window unavailable`)
  expect(originalSource(1)).toContain('day1otlk.html')
  expect(originalSource(8)).toContain('day4-8')
  expect(originalSource(11)).toBeNull()
 })
})
