export type PcResult={pcReady:boolean;feedReady:boolean;outputsOff:boolean;facebookConfigured:boolean;youtubeConfigured:boolean}
export type PcLauncher={online:boolean;host:string;observedAt:string|null;controlAccess?:{allowed:boolean};last?:{requestId:string;action:"prepare"|"check";state:string;createdAt:number;completedAt?:number;result?:PcResult}|null}
export function preparationPending(doc:PcLauncher|null){return ["queued","delivered"].includes(doc?.last?.state??"")}
export function canPrepare(doc:PcLauncher|null,busy:boolean){return doc?.online===true&&doc.controlAccess?.allowed===true&&!busy&&!preparationPending(doc)&&doc.last?.state!=="unknown"}
export const STREAM_WORK=[
 {id:"camera360",title:"360 camera ingest",state:"TEST ONLY",detail:"Proof-of-concept test camera. Not a production camera, on-air qualification, or authorization to publish.",next:"Verify private picture/audio, actual resolution, source selection, and reconnect recovery before considering production use."},
 {id:"dual-output",title:"Facebook + YouTube controls",state:"AVAILABLE · QUALIFICATION PENDING",detail:"Confirmed OBS destination controls are available. Public starts stay separate from preparation; YouTube destination and real camera/audio checks are still pending.",next:"Verify the actual destination and PROGRAM picture/audio before any explicitly approved public start."},
 {id:"readiness",title:"Streaming PC preparation",state:"REMOTE PREPARATION",detail:"Prepare the existing PC setup from an approved OPS account. Starts missing OBS/support components only; never restarts running services or starts public streaming.",next:"PC must be powered on with its Windows helper running. A browser cannot wake a powered-off PC."},
] as const

export function preparationDisabledReason(doc: PcLauncher | null, busy: boolean): string {
 if (!doc?.online) return "Helper offline / unknown"
 if (!doc.controlAccess?.allowed) return "Remote preparation requires an approved producer account"
 if (busy) return "Request in progress"
 if (preparationPending(doc)) return "Waiting for the current request"
 if (doc.last?.state === "unknown") return "Previous delivery uncertain; use Check PC only"
 return ""
}
