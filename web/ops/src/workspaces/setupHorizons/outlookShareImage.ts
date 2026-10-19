import {OPS_TIME_ZONE} from '../../core/timeFormat'
import {categoryOf,categoryLabel} from './outlookCategory'
import {clock,date,contentState,type Source} from './outlookModel'
import type {ProjectedRegion} from './outlookGeometry'
import {SHARE_FOOTER_HANDLE,type SharePreset} from './outlookShareConfig'
export type ShareInput={day:number;valid?:string;source?:Source;regions:ProjectedRegion[];states:string[];stale:boolean;minimumSpan:number;now?:number}
export type TextCommand={text:string;x:number;y:number;size:number;font:'Anton'|'Rajdhani';color:string;maxWidth:number;align?:'right'}
export type Crop={x:number;y:number;width:number;height:number}
function oneRiskCluster(regions:ProjectedRegion[]):boolean {
 const boxes=regions.filter(r=>r.points.length).map(({points})=>({left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}))
 if(!boxes.length)return false
 const connected=new Set([0]);let changed=true
 while(changed){changed=false;boxes.forEach((box,i)=>{if(connected.has(i))return;if([...connected].some(j=>box.left<=boxes[j].right&&box.right>=boxes[j].left&&box.top<=boxes[j].bottom&&box.bottom>=boxes[j].top)){connected.add(i);changed=true}})}
 return connected.size===boxes.length
}
export function riskCrop(regions:ProjectedRegion[],minimumSpan:number):Crop{
 const points=regions.flatMap(r=>r.points).filter(p=>p.every(Number.isFinite))
 if(!points.length)return{x:0,y:0,width:1000,height:600}
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2
 const width=Math.max(minimumSpan,(Math.max(...xs)-Math.min(...xs))*1.16),height=Math.max(minimumSpan,(Math.max(...ys)-Math.min(...ys))*1.16)
 return{x:cx-width/2,y:cy-height/2,width,height}
}
export function centralDate(value:string){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:OPS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value))
 const part=(name:string)=>parts.find(p=>p.type===name)?.value
 return `${part('year')}-${part('month')}-${part('day')}`
}
// Pure draw/text plan is shared by all presets and tested without a browser or network.
export function sharePlan(input:ShareInput,preset:SharePreset,zoom?:boolean,config:{handle?:string}={handle:SHARE_FOOTER_HANDLE}){
 const handle=config.handle
 const spec=input.day>=9,w=preset.width,h=preset.height,link=w===1200,story=h===1920,floor=link?40:36
 const top=story?250:Math.round(h*.05),left=w*.05,right=w*.95
 const useZoom=zoom??(link&&oneRiskCluster(input.regions))
 const valid=input.valid??input.source?.valid_from
 const safeDate=valid&&Number.isFinite(Date.parse(valid))?valid:undefined
 const stamp=safeDate?centralDate(safeDate):'undated'
 const filename=`codeblackwx-outlook-day${input.day}-${stamp}${spec?'-spec':''}${useZoom?'-zoom':''}-${w}x${h}.png`
 const sorted=input.regions.toSorted((a,b)=>categoryOf(a.row).rank-categoryOf(b.row).rank)
 const cats=[...new Map(sorted.map(r=>{const c=categoryOf(r.row);return[c.key,c] as const})).values()].reverse()
 const highest=sorted.at(-1)?.row
 const expired=contentState(input.source,highest,input.now)==='Expired'
 const state=[input.stale?'STALE':'',expired?'EXPIRED · valid window ended':'',spec?'SPECULATIVE · low confidence':''].filter(Boolean).join(' · ')
 const source=spec?'Code Black WX analysis · not SPC':'Source: NOAA SPC'
 const validText=`${date(safeDate)} – ${clock(input.source?.valid_from)} – ${clock(input.source?.valid_until)}`
 const alt=spec?`Code Black WX speculative Day ${input.day} pattern signal for ${validText}; not an SPC outlook; low confidence. ${state}`:`Code Black WX Day ${input.day} severe outlook, valid ${validText}. Highest risk: ${highest?categoryLabel(highest):'None delineated'} over ${highest?.label??'no supplied area'}. Categories shown: ${cats.map(c=>c.name).join(', ')||'None delineated'}. Issued ${clock(input.source?.issued_at)}. ${source}. ${state}`
 const commands:TextCommand[]=[]
 const text=(value:string,x:number,y:number,size=floor,font:TextCommand['font']='Rajdhani',color='--cb-text',maxWidth=right-x)=>commands.push({text:value,x,y,size,font,color,maxWidth})
 const map=link?{x:565,y:100,width:575,height:300}:{x:left,y:top+(story?310:240),width:right-left,height:story?680:h===1350?570:440}
 text('CODE BLACK',left,top+44,44,'Anton');text('WX',link?295:330,top+44,44,'Anton','--cb-red')
 if(!link)text(date(safeDate).toUpperCase(),w-330,top+44)
 text(`DAY ${input.day} ${spec?'PATTERN':'OUTLOOK'}`,left,top+(story?180:133),link?64:story?96:72,'Anton','--cb-text',link?490:right-left)
 if(link){text(date(safeDate),left,top+175);text(`${clock(input.source?.valid_from)}`,left,top+215);text(`– ${clock(input.source?.valid_until)}`,left,top+255)}
 else text(`Valid ${validText}`,left,top+(story?235:187),floor,'Rajdhani',spec?'--cb-outlook-spec':'--cb-text')
 if(link){
  const lines=[ [input.stale?'STALE':'',expired?'EXPIRED':''].filter(Boolean).join(' · '),expired?'Valid window ended':'',spec?'SPECULATIVE':''].filter(Boolean)
  lines.forEach((line,i)=>text(line,left,330+i*40,floor,'Rajdhani',spec?'--cb-outlook-spec':'--cb-amber',480))
 }else if(state)text(state.replace(' · low confidence',''),left,top+(story?280:230),floor,'Rajdhani',spec?'--cb-outlook-spec':'--cb-amber',right-left)
 const legendY=link?442:map.y+map.height+52
 const legends=cats.length?cats.map(c=>`${c.code}${c.rank>0?' '+c.rank:''}`):['None delineated']
 // Six categories fit two rows; the link card uses two columns within its left band.
 const swatches:Array<{x:number;y:number;cat:typeof cats[number]}>=[]
 legends.forEach((label,i)=>{
  const x=(link?565:left)+(i%(link?2:3))*(link?285:320),y=legendY+Math.floor(i/(link?2:3))*(floor+12)
  if(cats[i])swatches.push({x,y:y-floor*.7,cat:cats[i]})
  text(label,x+(cats[i]?62:0),y,floor,'Rajdhani',cats[i]?`--cb-outlook-${cats[i].key}`:'--cb-muted',cats[i]?.key==='spec'?(link?510:860):link?220:248)
 })
 if(spec)text('Low confidence · not an SPC risk',link?565:left,legendY+floor+12,floor,'Rajdhani','--cb-outlook-spec',link?575:right-left)
 const footer=story?1440:h===1350?1160:h===1080?900:460
 text(`Issued ${clock(input.source?.issued_at)}${link?'':' '+date(input.source?.issued_at)}`,left,footer,floor,'Rajdhani','--cb-text',link?480:right-left)
 text(link?(spec?'Code Black WX analysis':source):`${source} · US Census`,left,footer+floor+7,floor,'Rajdhani','--cb-muted',link?480:right-left)
 if(link)text(spec?'not SPC · US Census':'US Census boundaries',left,546,floor,'Rajdhani','--cb-muted',480)
 if(handle?.trim())commands.push({text:handle,x:right,y:link?590:footer+2*(floor+7),size:floor,font:'Rajdhani',color:'--cb-muted',maxWidth:right-left,align:'right'})
 return{filename,alt,commands,swatches,map,crop:useZoom?riskCrop(sorted,input.minimumSpan):{x:0,y:0,width:1000,height:600},regions:sorted,cats,spec,zoom:useZoom,state}
}
function token(name:string){const value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();if(!value)throw Error(`Missing export token ${name}`);return value}
function fitText(ctx:CanvasRenderingContext2D,c:TextCommand){
 ctx.font=`${c.font==='Rajdhani'?600:400} ${c.size}px ${c.font}`;ctx.fillStyle=token(c.color);ctx.textAlign=c.align??'left'
 // Wrap at the fixed font floor rather than resampling text with fillText's maxWidth.
 const words=c.text.split(' ');let line='',y=c.y
 for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>c.maxWidth){ctx.fillText(line,c.x,y);line=word;y+=c.size*1.08}else line=next}
 if(line)ctx.fillText(line,c.x,y)
 ctx.textAlign='left'
}
export async function drawShareImage(input:ShareInput,preset:SharePreset,zoom?:boolean){
 const loaded=await Promise.all([document.fonts.load('72px Anton'),document.fonts.load('600 36px Rajdhani'),document.fonts.load('700 36px Rajdhani')])
 if(loaded.some(fonts=>!fonts.length))throw Error('Self-hosted export fonts unavailable. Refresh and retry.')
 const plan=sharePlan(input,preset,zoom),canvas=document.createElement('canvas');canvas.width=preset.width;canvas.height=preset.height
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable')
 const bg=ctx.createLinearGradient(0,0,0,preset.height);bg.addColorStop(0,token('--cb-panel'));bg.addColorStop(1,token('--cb-outlook-sea'));ctx.fillStyle=bg;ctx.fillRect(0,0,preset.width,preset.height)
 ctx.strokeStyle='rgba(255,255,255,.025)';ctx.lineWidth=1
 for(let x=0;x<preset.width;x+=3){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,preset.height);ctx.stroke()}
 ctx.fillStyle=token('--cb-red');ctx.fillRect(preset.width*.05,preset.height===1920?310:Math.round(preset.height*.05)+60,preset.width*.9,2)
 const m=plan.map,crop=plan.crop,scale=Math.min(m.width/crop.width,m.height/crop.height)
 ctx.fillStyle=token('--cb-panel-hi');ctx.beginPath();ctx.roundRect(m.x-7,m.y-7,m.width+14,m.height+14,20);ctx.fill()
 ctx.save();ctx.beginPath();ctx.roundRect(m.x,m.y,m.width,m.height,20);ctx.clip();ctx.fillStyle=token('--cb-outlook-sea');ctx.fillRect(m.x,m.y,m.width,m.height)
 ctx.translate(m.x+(m.width-crop.width*scale)/2,m.y+(m.height-crop.height*scale)/2);ctx.scale(scale,scale);ctx.translate(-crop.x,-crop.y)
 for(const d of input.states){const path=new Path2D(d);ctx.fillStyle=token('--cb-outlook-land');ctx.fill(path);ctx.strokeStyle=token('--cb-outlook-state');ctx.lineWidth=2/scale;ctx.stroke(path)}
 for(const region of plan.regions){const cat=categoryOf(region.row),path=new Path2D(region.d),color=token(`--cb-outlook-${cat.key}`),width=Math.max(3,cat.width*1.4)/scale
 ctx.fillStyle=color;ctx.globalAlpha=plan.spec?.35:1;ctx.fill(path,'evenodd');ctx.globalAlpha=1
 if(cat.pattern!=='none'){
 ctx.save();ctx.clip(path,'evenodd');ctx.strokeStyle='rgba(0,0,0,.32)';ctx.lineWidth=2/scale
 const step=cat.pattern==='dense'?9:16
 for(let x=crop.x-crop.height;x<crop.x+crop.width+crop.height;x+=step){ctx.beginPath();ctx.moveTo(x,crop.y);ctx.lineTo(x+(cat.pattern==='spec'?-crop.height:crop.height),crop.y+crop.height);ctx.stroke();if(cat.pattern==='cross'||cat.pattern==='dense'){ctx.beginPath();ctx.moveTo(x,crop.y);ctx.lineTo(x-crop.height,crop.y+crop.height);ctx.stroke()}}
 ctx.restore()}
 ctx.strokeStyle=color;ctx.lineWidth=width+5/scale;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.globalAlpha=.55;ctx.stroke(path);ctx.globalAlpha=1;ctx.shadowBlur=0
 ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=width+3/scale;ctx.stroke(path)
 ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(cat.key==='tstm'||cat.key==='spec'?[10/scale,6/scale]:[]);ctx.stroke(path);ctx.setLineDash([])
 }
 ctx.strokeStyle='rgba(0,0,0,.38)';ctx.lineWidth=2/scale;for(const d of input.states)ctx.stroke(new Path2D(d))
 ctx.restore()
 const top=plan.regions.at(-1)
 if(top){
  const cat=categoryOf(top.row),label=plan.spec?'PATTERN SIGNAL':`${cat.code}${cat.rank>0?' '+cat.rank:''}`
  const points=top.points,xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
  const x=m.x+(m.width-crop.width*scale)/2+((Math.min(...xs)+Math.max(...xs))/2-crop.x)*scale
  const y=m.y+(m.height-crop.height*scale)/2+((Math.min(...ys)+Math.max(...ys))/2-crop.y)*scale
  ctx.font=`700 ${preset.width===1200?40:36}px Rajdhani`;const width=ctx.measureText(label).width+28
  const cx=Math.max(m.x+width/2+4,Math.min(m.x+m.width-width/2-4,x)),cy=Math.max(m.y+30,Math.min(m.y+m.height-30,y))
  ctx.fillStyle=token('--cb-outlook-label-bg');ctx.beginPath();ctx.roundRect(cx-width/2,cy-28,width,54,14);ctx.fill();ctx.strokeStyle=token(`--cb-outlook-${cat.key}`);ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=token(`--cb-outlook-${cat.key}`);ctx.textAlign='center';ctx.fillText(label,cx,cy+12);ctx.textAlign='left'
 }
 if(plan.spec){ctx.save();ctx.beginPath();ctx.rect(m.x,m.y,m.width,m.height);ctx.clip();ctx.translate(m.x+m.width/2,m.y+m.height/2);ctx.rotate(-Math.PI/10);ctx.globalAlpha=.16;ctx.font='72px Anton';ctx.textAlign='center';ctx.fillStyle=token('--cb-outlook-spec');ctx.fillText('SPECULATIVE',0,0);ctx.restore()}
 for(const swatch of plan.swatches){
  const color=token(`--cb-outlook-${swatch.cat.key}`),{x,y}=swatch
  ctx.fillStyle=color;ctx.fillRect(x,y,46,28);ctx.strokeStyle=color;ctx.lineWidth=3
  ctx.setLineDash(swatch.cat.key==='tstm'?[10,6]:[]);ctx.strokeRect(x,y,46,28);ctx.setLineDash([])
  if(swatch.cat.pattern!=='none'){ctx.save();ctx.beginPath();ctx.rect(x,y,46,28);ctx.clip();ctx.strokeStyle='#0008';ctx.lineWidth=3;for(let d=-28;d<60;d+=9){ctx.beginPath();ctx.moveTo(x+d,y);ctx.lineTo(x+d+28,y+28);ctx.stroke();if(swatch.cat.pattern==='cross'||swatch.cat.pattern==='dense'){ctx.beginPath();ctx.moveTo(x+d,y);ctx.lineTo(x+d-28,y+28);ctx.stroke()}}ctx.restore()}
 }
 for(const command of plan.commands)fitText(ctx,command)
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed')),'image/png'))
 return{blob,...plan}
}
export async function shareOutlook(input:ShareInput,preset:SharePreset,zoom?:boolean){
 const result=await drawShareImage(input,preset,zoom),file=new File([result.blob],result.filename,{type:'image/png'})
 if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:`Day ${input.day} outlook`,text:result.alt});return}catch(error){if(error instanceof DOMException&&error.name==='AbortError')return}}
 const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download=result.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
