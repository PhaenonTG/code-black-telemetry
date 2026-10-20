import {fetchForecast} from '../../../core/client'
import type {OpsCoreConfig} from '../../../core/config'
import {requestDeadline} from '../../../core/requestDeadline'
import type {GraphicDataset,GraphicProduct} from './forecastGraphicModel'

const PRODUCTS=new Set<GraphicProduct>(['categorical','tornado','wind','hail','severe','key-messages'])
export function validateGraphicDataset(value:unknown):GraphicDataset{
 const data=value as Partial<GraphicDataset>
 if(data.schema!=='codeblack.spc.graphics.v2'||!Array.isArray(data.regions)||data.regions.length>4000||!Array.isArray(data.sources)||data.sources.length>24)throw Error('Invalid SPC graphics dataset')
 if(data.sources.some(source=>!PRODUCTS.has(source.product)||source.day<1||source.day>8||!['available','no_delineated_area','unavailable','stale'].includes(source.status)||!source.source_url?.startsWith('https://')))throw Error('Invalid SPC graphics source')
 if(data.regions.some(row=>row.day<1||row.day>8||!row.source_url?.startsWith('https://')||!['Polygon','MultiPolygon'].includes(row.geometry?.type)))throw Error('Invalid SPC graphics region')
 if(data.analysis&&!Array.isArray(data.analysis))throw Error('Invalid reviewed analysis')
 if(data.analysis?.some(item=>item.status!=='reviewed'||item.day<1||item.day>8||!item.reviewed_at||!item.reviewer||!item.source_note||!item.summary||!Array.isArray(item.key_messages)||item.key_messages.length>5))throw Error('Invalid reviewed analysis')
 return data as GraphicDataset
}
export async function loadSpcGraphics(config:OpsCoreConfig,signal?:AbortSignal){return validateGraphicDataset(await requestDeadline(inner=>fetchForecast<unknown>(config,'spc-graphics',inner),10_000,signal))}
