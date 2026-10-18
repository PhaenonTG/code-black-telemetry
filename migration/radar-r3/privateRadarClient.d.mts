import type {RadarFrame} from '../../../../src/services/radar';
export type PilotSelection={site:'KSRX';product:'REF'|'VEL'|'CC';cut:number};
export function pilotSelection(product?:string):PilotSelection;
export function createPrivateRadarClient(options:{getSession:()=>{accessToken:string;expiresAtMs:number}|null;fetchImpl?:typeof fetch;now?:()=>number}):{
 transformTileRequest(url:string):{url:string;headers:{Authorization:string}}|null;
 read(path:string,options?:{signal?:AbortSignal}):Promise<{state:string;data?:unknown;reason?:string|null}>;
};
export function acceptedFrameView(frame:unknown,selection:PilotSelection,sourceLoadedFrameId:string|null):{state:string;frame:RadarFrame|null};
export function metadataLegend(frame:unknown,product:string):{units:string;min:number;max:number;gradient:string}|null;
