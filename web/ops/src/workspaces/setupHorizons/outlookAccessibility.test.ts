import {readFileSync} from 'node:fs'
import {describe,it,expect} from 'vitest'
import {CATEGORIES} from './outlookCategory'
const tokens=readFileSync(new URL('../../styles/tokens.css',import.meta.url),'utf8')
const css=readFileSync(new URL('./horizons.css',import.meta.url),'utf8')
const color=(name:string)=>{
 const hex=tokens.match(new RegExp(`--cb-outlook-${name}: #([0-9a-fA-F]{6})`))![1]
 return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255)
}
const luminance=(rgb:number[])=>rgb.reduce((value,c,i)=>value+[.2126,.7152,.0722][i]*(c<=.04045?c/12.92:((c+.055)/1.055)**2.4),0)
describe('RC9 / RC12 non-color and contrast checks',()=>{
 it('meets 3:1 fill contrast against the brighter land gradient endpoint',()=>{
  const land=color('land')
  for(const cat of CATEGORIES.filter(c=>c.rank>=0)){
   const fill=color(cat.key).map((c,i)=>c*cat.opacity+land[i]*(1-cat.opacity))
   expect((luminance(fill)+.05)/(luminance(land)+.05),cat.key).toBeGreaterThanOrEqual(3)
  }
 })
 it('keeps MDT cross-hatched and explicitly ranked; TSTM and MRGL differ without hue',()=>{
  expect(CATEGORIES.find(c=>c.key==='mdt')).toMatchObject({pattern:'cross',code:'MDT',rank:4})
  expect(css).toContain('[data-cat=tstm] .setup-horizons__region { stroke-dasharray: 6 4; }')
  expect(css).toContain('[data-cat=tstm] i { background: transparent; border-style: dashed; }')
  expect(css).toContain('border: 2px solid var(--cb-red)')
 })
 it('caps pulse at three cycles and keeps motion behind the reduced-motion preference',()=>{
  expect(css).toContain('@media (prefers-reduced-motion: no-preference)')
  expect(css).toContain('animation: outlook-pulse 2.4s ease-in-out 3')
  expect(css).not.toContain('infinite')
 })
})
