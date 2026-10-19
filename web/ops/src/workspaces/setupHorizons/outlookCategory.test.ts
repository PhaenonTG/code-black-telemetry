import {describe,it,expect,vi} from 'vitest'
import {CATEGORIES,categoryOf} from './outlookCategory'

describe('SPC category semantics',()=>{
 it.each([[2,'tstm',0],[3,'mrgl',1],[4,'slgt',2],[5,'enh',3],[6,'mdt',4],[8,'high',5]] as const)('maps DN %s independently of tornado probabilities',(official_code,key,rank)=>{
  expect(categoryOf({official_code,label:''})).toMatchObject({key,rank})
 })
 it.each([['General thunderstorms','tstm'],['Marginal risk','mrgl'],['SLGT','slgt'],['Enhanced','enh'],['Moderate','mdt'],['HIGH','high'],['15% severe','slgt'],['30% severe','enh']])('falls back to %s with an unknown code',(label,key)=>{
  expect(categoryOf({official_code:99,label}).key).toBe(key)
 })
 it('warns on mismatch, prefers the code, and separates speculative content',()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
  expect(categoryOf({official_code:6,label:'Slight risk'}).key).toBe('mdt')
  expect(warn).toHaveBeenCalledOnce()
  expect(categoryOf({day:11,official_code:8,label:'High risk'}).key).toBe('spec')
  expect(categoryOf({label:'Unrecognized'}).key).toBe('unknown')
  warn.mockRestore()
 })
 it('SPC fill opacities never decrease TSTM to HIGH and are all >= 0.45',()=>{
  const opacities=['TSTM','MRGL','SLGT','ENH','MDT','HIGH'].map(code=>CATEGORIES.find(c=>c.code===code)!.opacity)
  opacities.forEach((opacity,i)=>{
   expect(opacity).toBeGreaterThanOrEqual(0.45)
   if(i>0)expect(opacity).toBeGreaterThanOrEqual(opacities[i-1])
  })
 })
})
