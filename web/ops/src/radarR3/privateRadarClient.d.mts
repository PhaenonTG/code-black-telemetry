import type {RadarFrame} from '../../../../src/services/radar';
export type PilotSelection={site:string;product:'REF'|'VEL'|'CC';cut:number};
export function pilotSelection(product?:string,site?:string):PilotSelection;
export function createPrivateRadarClient(options:{origin?:string;getSession:()=>{accessToken:string;expiresAtMs:number}|null;fetchImpl?:typeof fetch;now?:()=>number}):{
 transformTileRequest(url:string):{url:string;headers:{Authorization:string}}|null;
 read(path:string,options?:{signal?:AbortSignal}):Promise<{state:string;data?:unknown;reason?:string|null}>;
};
export function acceptedFrameView(frame:unknown,selection:PilotSelection,sourceLoadedFrameId:string|null,origin?:string):{state:string;frame:RadarFrame|null};
export function metadataLegend(frame:unknown,product:string):{units:string;min:number;max:number;gradient:string}|null;

export function radarOrigin(value?:string):string;
