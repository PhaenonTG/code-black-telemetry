import {describe,expect,it} from 'vitest'
import {validateGraphicDataset} from './spcGraphicsRead'

describe('SPC graphics dataset validation',()=>{
 it('accepts authoritative product states including no delineated area',()=>{const value=validateGraphicDataset({schema:'codeblack.spc.graphics.v2',checked_at:'2026-10-20T22:00:00Z',regions:[],sources:[{product:'tornado',day:1,status:'no_delineated_area',source_url:'https://mapservices.weather.noaa.gov/layer/3'},{product:'severe',day:8,status:'no_delineated_area',source_url:'https://mapservices.weather.noaa.gov/layer/25'}]});expect(value.sources[1].day).toBe(8)})
 it('rejects arbitrary or non-HTTPS provenance',()=>{expect(()=>validateGraphicDataset({schema:'codeblack.spc.graphics.v2',checked_at:null,regions:[],sources:[{product:'tornado',day:1,status:'available',source_url:'http://example.test'}]})).toThrow('Invalid SPC graphics source')})
 it('rejects unreviewed analysis posing as key messages',()=>{expect(()=>validateGraphicDataset({schema:'codeblack.spc.graphics.v2',checked_at:null,regions:[],sources:[],analysis:[{status:'draft',day:1}]})).toThrow('Invalid reviewed analysis')})
})
