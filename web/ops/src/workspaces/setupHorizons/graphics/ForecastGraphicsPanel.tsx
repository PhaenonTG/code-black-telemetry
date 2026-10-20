import {useEffect,useMemo,useState} from 'react'
import type {OpsCoreConfig} from '../../../core/config'
import type {Catalog} from '../HorizonCatalog'
import {FORECAST_GRAPHIC_PRESETS} from './forecastGraphicPresets'
import {availableProducts,datasetFromCatalog,PRODUCT_META,reviewedAnalysisFor,sourceFor,type GraphicCoverage,type GraphicProduct} from './forecastGraphicModel'
import {downloadForecastGraphic} from './renderForecastGraphic'
import {loadSpcGraphics} from './spcGraphicsRead'

const HD_INDEX=FORECAST_GRAPHIC_PRESETS.findIndex(preset=>preset.width===1920&&preset.height===1080)

export function ForecastGraphicsPanel({catalog,config}:{catalog:Catalog;config?:OpsCoreConfig}){
 const fallback=useMemo(()=>datasetFromCatalog(catalog),[catalog]),[extended,setExtended]=useState<typeof fallback|null>(null),dataset=extended??fallback,[day,setDay]=useState(1),[product,setProduct]=useState<GraphicProduct>('categorical'),[coverage,setCoverage]=useState<GraphicCoverage>('national'),[presetIndex,setPresetIndex]=useState(HD_INDEX),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 useEffect(()=>{if(!config)return;const controller=new AbortController();void loadSpcGraphics(config,controller.signal).then(setExtended).catch(()=>undefined);return()=>controller.abort()},[config])
 const products=availableProducts(day),source=sourceFor({dataset,product,day}),analysis=reviewedAnalysisFor({dataset,day}),ready=product==='key-messages'?!!analysis:!!source&&source.status!=='unavailable'
 const selectDay=(nextDay:number)=>{setDay(nextDay);const nextProducts=availableProducts(nextDay);if(!nextProducts.includes(product))setProduct(nextProducts[0]??'categorical')}
 const render=async()=>{setBusy(true);setError(null);try{await downloadForecastGraphic({dataset,product,day,coverage,preset:FORECAST_GRAPHIC_PRESETS[presetIndex]})}catch(caught){setError(caught instanceof Error?caught.message:'Graphic export failed.')}finally{setBusy(false)}}
 return <section className="forecast-graphics" aria-label="Forecast graphics engine">
  <header><div><span className="forecast-graphics__eyebrow">CODE BLACK WX GRAPHICS ENGINE</span><h3>Independent forecast exports</h3><p>Official SPC products and timestamps remain separate from reviewed Code Black analysis.</p></div><span className="forecast-graphics__phase">DESKTOP · FULL STACK</span></header>
  <div className="forecast-graphics__controls">
   <label>Day<select value={day} onChange={event=>selectDay(Number(event.target.value))}>{Array.from({length:8},(_,index)=>index+1).map(value=><option key={value} value={value}>Day {value}</option>)}</select></label>
   <label>Product<select value={product} onChange={event=>setProduct(event.target.value as GraphicProduct)}>{products.map(value=><option key={value} value={value}>{PRODUCT_META[value].short}</option>)}</select></label>
   <label>Coverage<select value={coverage} onChange={event=>setCoverage(event.target.value as GraphicCoverage)}><option value="national">Adaptive national</option><option value="southern-plains">Southern Plains</option></select></label>
   <label>Output<select value={presetIndex} onChange={event=>setPresetIndex(Number(event.target.value))}>{FORECAST_GRAPHIC_PRESETS.map((preset,index)=><option key={preset.label} value={index}>{preset.label} · {preset.width}×{preset.height}</option>)}</select></label>
   <button type="button" className="ops-button-primary" disabled={!ready||busy} onClick={()=>void render()}>{busy?'Rendering verified map…':'Export standalone PNG'}</button>
  </div>
  {!ready&&<p className="forecast-graphics__guard"><strong>Day {day} {PRODUCT_META[product].title}</strong> is withheld until its product-specific NOAA SPC record or reviewed Code Black analysis is available. Missing data is never converted into a zero-risk forecast.</p>}
  {error&&<p className="forecast-graphics__error" role="alert">{error}</p>}
  <footer>Days 1–8 · national + regional · official SPC geography · reviewed analysis only · independent files</footer>
 </section>
}
