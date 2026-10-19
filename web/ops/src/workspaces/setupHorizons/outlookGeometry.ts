import topology from './us-states.topo.json'
import type {Region} from './outlookModel'
export type ProjectedRegion={row:Region;d:string;points:number[][]}
// Pinned ISC us-atlas boundaries; same Albers equal-area projection as reviewed slice.
function arc(index:number){let x=0,y=0;const rows=(topology.arcs[index<0?~index:index] as number[][]).map(([dx,dy])=>{x+=dx;y+=dy;return[x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]]});return index<0?rows.reverse():rows}
const states=(topology.objects.states.geometries as any[]).map(g=>({id:Number(g.id),name:g.properties.name,polygons:(g.type==='Polygon'?[g.arcs]:g.arcs).map((p:number[][])=>p.map(ids=>ids.flatMap((id,i)=>arc(id).slice(i?1:0))))}))
const rad=Math.PI/180,n=(Math.sin(29.5*rad)+Math.sin(45.5*rad))/2,c=Math.cos(29.5*rad)**2+2*n*Math.sin(29.5*rad),rho0=Math.sqrt(c-2*n*Math.sin(38*rad))/n
function raw([lon,lat]:number[]){const rho=Math.sqrt(c-2*n*Math.sin(lat*rad))/n,theta=n*(lon+96)*rad;return[rho*Math.sin(theta),-(rho0-rho*Math.cos(theta))]}
export function mapShape(coverage:string){
 const selected=states.filter(s=>coverage==='alaska'?s.name==='Alaska':coverage==='hawaii'?s.name==='Hawaii':s.id<=56&&![2,15].includes(s.id))
 const project=coverage==='conus'?raw:([lon,lat]:number[])=>[lon>0?lon-360:lon,-lat]
 const points=selected.flatMap(s=>s.polygons.flat(2).map(project)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(900/(maxX-minX),460/(maxY-minY))
 const path=(polygons:any[])=>polygons.map(p=>p.map((ring:number[][])=>ring.map((point,i)=>{const[x,y]=project(point);return`${i?'L':'M'}${(500+(x-(minX+maxX)/2)*scale).toFixed(2)},${(300+(y-(minY+maxY)/2)*scale).toFixed(2)}`}).join('')+'Z').join('')).join('')
 const projectPoint=(point:number[])=>{const[x,y]=project(point);return[500+(x-(minX+maxX)/2)*scale,300+(y-(minY+maxY)/2)*scale]}
 return {selected: selected.map(s=>({...s,d:path(s.polygons)})),path,projectPoint,minimumSpan:(500/6371)*scale}
}
