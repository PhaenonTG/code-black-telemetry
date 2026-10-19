import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read=(rel:string)=>readFileSync(fileURLToPath(new URL(rel,import.meta.url)),'utf8')
const tokens=read('../../styles/tokens.css')
const share=read('./outlookShareImage.ts')

function resolve(name:string,seen=new Set<string>()):string{
  if(seen.has(name))throw Error(`cycle at ${name}`);seen.add(name)
  const decls=[...tokens.matchAll(new RegExp(`${name.replace(/-/g,'\\-')}\\s*:\\s*([^;]+);`,'g'))]
  if(!decls.length)throw Error(`${name} not defined`)
  const value=decls.at(-1)![1].trim(),ref=value.match(/^var\((--[\w-]+)\)$/)
  return ref?resolve(ref[1],seen):value
}

describe('Outlook export laser color',()=>{
  it('resolves --cb-outlook-laser to brand red #FF2A0C without depending on .shell',()=>{
    expect(resolve('--cb-outlook-laser').toUpperCase()).toBe('#FF2A0C')
  })
  it('the share image reads --cb-outlook-laser for the WX mark and the laser rule, never --cb-red or --cb-laser',()=>{
    expect(share.match(/'--cb-outlook-laser'/g)?.length).toBe(2)
    expect(share).not.toMatch(/'--cb-red'/)
    expect(share).not.toMatch(/'--cb-laser'/)
  })
})
