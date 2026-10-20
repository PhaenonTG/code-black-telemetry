import mapboxgl from 'mapbox-gl'
import {atlasStyleUri,hasMapboxToken,mapboxAccessToken} from '../../../../../../src/services/mapTiles'
import {COVERAGE_BOUNDS,regionColor,regionRank,regionsFor,type GraphicRequest} from './forecastGraphicModel'

const MAP_TIMEOUT_MS=20_000

function featureCollection(request:GraphicRequest):mapboxgl.GeoJSONSourceSpecification['data']{
 return{type:'FeatureCollection',features:regionsFor(request).toSorted((a,b)=>regionRank(a)-regionRank(b)).map(row=>({type:'Feature',properties:{color:regionColor(row),rank:regionRank(row),significant:!!row.significant,overlay:!!row.overlay_only},geometry:row.geometry}))} as mapboxgl.GeoJSONSourceSpecification['data']
}

export async function renderMapboxBasemap(request:GraphicRequest,width:number,height:number):Promise<HTMLCanvasElement>{
 if(!hasMapboxToken())throw Error('Mapbox public token is unavailable; verified geography export cannot be produced.')
 const host=document.createElement('div')
 Object.assign(host.style,{position:'fixed',left:'-100000px',top:'0',width:`${width}px`,height:`${height}px`,pointerEvents:'none'})
 document.body.append(host)
 mapboxgl.accessToken=mapboxAccessToken()
 const map=new mapboxgl.Map({container:host,style:atlasStyleUri(),bounds:COVERAGE_BOUNDS[request.coverage],fitBoundsOptions:{padding:request.coverage==='national'?44:22},attributionControl:false,interactive:false,preserveDrawingBuffer:true,fadeDuration:0})
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=window.setTimeout(()=>reject(Error('Mapbox basemap timed out before export.')),MAP_TIMEOUT_MS)
   map.once('load',()=>{
    map.addSource('spc-official',{type:'geojson',data:featureCollection(request)})
    const firstLabel=map.getStyle().layers?.find(layer=>layer.type==='symbol')?.id
    map.addLayer({id:'spc-official-fill',type:'fill',source:'spc-official',filter:['!=',['get','overlay'],true],paint:{'fill-color':['get','color'],'fill-opacity':.25}},firstLabel)
    map.addLayer({id:'spc-official-outline',type:'line',source:'spc-official',filter:['!=',['get','overlay'],true],paint:{'line-color':['get','color'],'line-opacity':.96,'line-width':['interpolate',['linear'],['zoom'],3,1.5,7,3]}},firstLabel)
    map.addLayer({id:'spc-significant',type:'line',source:'spc-official',filter:['==',['get','significant'],true],paint:{'line-color':'#F4F6FA','line-opacity':.95,'line-width':2.5,'line-dasharray':[2,2]}},firstLabel)
    map.once('idle',()=>{window.clearTimeout(timer);resolve()})
   })
   map.once('error',event=>{if(!map.loaded()){window.clearTimeout(timer);reject(Error(`Mapbox basemap failed: ${event.error?.message??'unknown error'}`))}})
  })
  const source=map.getCanvas(),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height
  const context=copy.getContext('2d');if(!context)throw Error('Canvas unavailable')
  context.drawImage(source,0,0)
  return copy
 }finally{map.remove();host.remove()}
}
