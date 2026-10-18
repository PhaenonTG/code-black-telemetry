import type {Map} from 'mapbox-gl';
import type {RadarFrame} from '../../../../src/services/radar';
import type {PilotSelection,createPrivateRadarClient} from './privateRadarClient.mjs';
export function loadPilotFrame(client:ReturnType<typeof createPrivateRadarClient>,selection:PilotSelection,signal:AbortSignal):Promise<{state:string;frame?:RadarFrame}>;
export function mountPilotFrame(map:Map,frame:RadarFrame,selection:PilotSelection,onPromoted:(frame:RadarFrame)=>void):()=>void;
