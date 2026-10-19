import {describe,it,expect} from 'vitest'
import {sharePlan,riskCrop,centralDate} from './outlookShareImage'
import {SHARE_PRESETS,SHARE_FOOTER_HANDLE} from './outlookShareConfig'
import type {ShareInput} from './outlookShareImage'
const source={day:1,status:'available',valid_from:'2026-11-02T12:00:00Z',valid_until:'2026-11-03T12:00:00Z',issued_at:'2026-11-02T11:00:00Z'}
const input:ShareInput={day:1,valid:source.valid_from,source,regions:[],states:[],stale:true,minimumSpan:100,now:Date.parse('2026-11-02T18:00:00Z')}
describe('every client-side share preset',()=>{
 for(const preset of SHARE_PRESETS)for(const day of [1,11])it(`${preset.width}x${preset.height}, day ${day}: handle, alt text, filename and CST`,()=>{
  const plan=sharePlan({...input,day},preset)
  expect(SHARE_FOOTER_HANDLE).toBe('@CodeBlackWX · codeblackwx.com')
  expect(JSON.stringify(plan)).not.toContain('{SOCIAL_HANDLE}')
  expect(plan.commands.map(c=>c.text).join(' ')).toContain(SHARE_FOOTER_HANDLE)
  for(const handle of ['',undefined]){
   const unset=JSON.stringify(sharePlan({...input,day},preset,undefined,{handle}))
   expect(unset).not.toContain(SHARE_FOOTER_HANDLE)
   expect(unset).not.toContain('{SOCIAL_HANDLE}')
  }
  expect(plan.alt).toContain('CST')
  expect(plan.commands.map(c=>c.text).join(' ')).toContain('CST')
  expect(plan.filename).toBe(`codeblackwx-outlook-day${day}-2026-11-02${day>=9?'-spec':''}-${preset.width}x${preset.height}.png`)
  expect(plan.commands.every(c=>c.size>=(preset.width===1200?40:36))).toBe(true)
  expect(plan.commands.map(c=>c.text).join(' ')).toContain('STALE')
  if(day>=9){expect(plan.spec).toBe(true);expect(plan.alt).toContain('not an SPC outlook')}
 })
 it('uses the Central calendar date near UTC midnight',()=>expect(centralDate('2026-11-03T01:00:00Z')).toBe('2026-11-02'))
 it('falls back to full CONUS for empty areas and keeps a 500 km minimum projected span',()=>{
  expect(riskCrop([],100)).toEqual({x:0,y:0,width:1000,height:600})
  const regions=[{d:'M1,1L2,2Z',points:[[1,1],[2,2]],row:{day:1,label:'High',official_code:8}}] as ShareInput['regions']
  expect(riskCrop(regions,100)).toEqual({x:-48.5,y:-48.5,width:100,height:100})
  const plan=sharePlan({...input,regions},SHARE_PRESETS[3])
  expect(plan.zoom).toBe(true)
  expect(plan.filename).toContain('-zoom-1200x630.png')
  expect(sharePlan({...input,regions},SHARE_PRESETS[3],false).zoom).toBe(false)
  expect(sharePlan({...input,regions:[...regions,...regions]},SHARE_PRESETS[3]).zoom).toBe(true)
  expect(sharePlan({...input,regions:[...regions,{...regions[0],points:[[800,400],[900,500]]}]},SHARE_PRESETS[3]).zoom).toBe(false)
 })
 it('exports an expired warning in the title band',()=>{
  const plan=sharePlan({...input,now:Date.parse('2026-11-04T00:00:00Z')},SHARE_PRESETS[0])
  expect(plan.commands.some(c=>c.text.includes('EXPIRED'))).toBe(true)
 })
})
