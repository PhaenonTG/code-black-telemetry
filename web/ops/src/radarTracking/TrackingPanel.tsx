import {useEffect,useId,useState} from 'react'
import {trackingView, replayMotion, replayExtrapolation} from './trackingView.mjs'
import './TrackingPanel.css'

// v0 is a research JSON contract. Validation is deliberately isolated in trackingView.
export function TrackingPanel({snapshot,site,product,frameId,mode='HISTORICAL_REPLAY',elapsedMs=0}:{snapshot:unknown;site:string;product:string;frameId:string;mode?:'HISTORICAL_REPLAY'|'LIVE_CLOCK_RESEARCH';elapsedMs?:number}) {
  const view=trackingView(snapshot,{site,product,frameId,mode,elapsedMs})
  const regionId=useId()
  // Scope selection to this source identity; late/incompatible snapshots cannot retain a selection.
  const scope=`${site}/${product}/${frameId}/${view.generation??''}`
  const [selection,setSelection]=useState({scope:'',id:''})
  const [estimateSelection,setEstimateSelection]=useState('')
  useEffect(()=>{setSelection({scope:'',id:''});setEstimateSelection('')},[scope])
  const track=view.available && selection.scope===scope ? view.tracks.find((value:any)=>value.id===selection.id) : null
  const motion=track?replayMotion(track,view):null, estimate=track?replayExtrapolation(track,view):null
  const estimateKey=track?`${scope}/${track.id}`:''
  const time=(value:string)=>new Date(value).toISOString()
  return <section className="tracking-panel" aria-label="Reflectivity region tracking">
    <h2>Reflectivity region tracks</h2>
    <p className="tracking-panel__notice">{mode==='HISTORICAL_REPLAY'?'Historical replay only · No live weather claim':'Live-clock research · Live qualification not established'} · Scientifically unqualified · Operational decisions disabled</p>
    <p>Echo regions are not official storm objects. No tornado, debris or warning inference.</p>
    {!view.available ? <p role="status">Tracking unavailable: {view.reason}</p> : <>
      <dl><dt>Source observation</dt><dd><time>{time(view.source.end)}</time></dd>
        <dt>{view.liveClock?'Observation age (conservative since read request)':'Observation age at replay clock'}</dt><dd>{Number.isFinite(view.age)?`${view.age.toFixed(1)} seconds`:'Unknown'}</dd>
        <dt>{view.liveClock?'Producer read clock':'Replay evaluation clock (fixed)'}</dt><dd>{time(view.evaluationAt)}</dd>
        <dt>Source</dt><dd>{site} · {product} · Cut 1 · <code>{frameId}</code></dd>
        <dt>Evidence state</dt><dd>{view.state}</dd></dl>
      {view.bridge && <details className="tracking-panel__provenance"><summary>Native-cache input provenance ({view.catalog.length} frames)</summary><p>{view.liveClock?'Cache IDs matched to the loaded radar image. Installed publisher status does not establish live or scientific qualification.':'Producer-compatible archived cache IDs. Historical replay only; live production identity is unverified.'}</p>{view.generation&&<p>Producer generation: <code>{view.generation}</code></p>}<ul>{view.catalog.map((record:any)=><li key={record.frameId}><code>{record.frameId}</code><br/>{time(new Date(record.start).toISOString())} to {time(new Date(record.end).toISOString())}<br/>{record.site} · {record.product} · {record.units} · Cut {record.cut} · Ordinal {record.ordinal}<br/>Source SHA256: <code>{record.sourceSha256}</code><br/>Native SHA256: <code>{record.nativeContentSha256}</code><br/>Render contract: <code>{record.renderContract}</code></li>)}</ul></details>}
      {(!view.fresh || !view.tracks.length) && <p role="status">{view.tracks.length?'Historical observations retained; current motion and extrapolation unavailable.':'Tracking unavailable: insufficient qualified evidence.'} {view.reasons.join('; ')}</p>}
      {!!view.tracks.length && <><label htmlFor={regionId}>Observed region</label><select id={regionId} value={track?.id??''} onChange={event=>{setSelection({scope,id:event.target.value});setEstimateSelection('')}}>
        <option value="">Select a region</option>{view.tracks.map((value:any)=><option key={value.id} value={value.id}>{value.id} · {value.history.length} observation(s)</option>)}
      </select>
      {!track && <p>Select a region to inspect its observed history.</p>}</>}
      {track && <article aria-label="Selected region details"><h3>{track.id}</h3><p>{track.association} · Confidence: UNQUALIFIED</p>
        <p>Observed centroid motion: {motion?`${motion.speedMetersPerSecond.toFixed(1)} m/s · ${motion.directionToDegrees===null?'direction unavailable below grid precision':`${motion.directionToDegrees.toFixed(1)}° toward, clockwise from true north`}`:'Unavailable: insufficient or suppressed evidence.'}</p>
        <p>Motion is echo-centroid displacement, not Doppler wind. Position error floor: {motion?`${motion.positionErrorFloorMeters} m`:'unavailable'}.</p>
        {track.suppressionReasons?.length>0 && <p>Evidence limits: {track.suppressionReasons.join('; ')}</p>}
        <h4>Observed history</h4><ol aria-label="Observed position history">{track.history.map((point:any)=><li key={point.frameId}><time>{time(point.time)}</time><br/>{point.position.lat.toFixed(4)}°, {point.position.lon.toFixed(4)}° · <code>{point.frameId}</code></li>)}</ol>
        <p>{view.bridge?`History resolves to the retained native-cache provenance catalog. ${view.liveClock?'Research observations only; continuity is scoped to this producer generation.':'IDs are from archived local replay; no live production identity claim.'}`:'History references archived input frames; these IDs are not production API IDs.'}</p>
        {estimate ? <><label><input type="checkbox" checked={estimateSelection===estimateKey} onChange={event=>setEstimateSelection(event.target.checked?estimateKey:'')}/> Show replay-only extrapolation</label>
          {estimateSelection===estimateKey && <div className="tracking-panel__estimate" aria-label="Replay-only extrapolation"><strong>Estimated position · REPLAY ONLY · Not an observation</strong><p>Valid {time(estimate.validTime)} · {estimate.leadSeconds}s from source observation</p><p>{estimate.position.lat.toFixed(4)}°, {estimate.position.lon.toFixed(4)}°</p><p>Heuristic uncertainty radius: {(estimate.uncertainty.radiusMeters/1000).toFixed(1)} km. This is not a probability or confidence interval.</p></div>}</> : <p>{view.publisher?'Extrapolation disabled for publisher research.':'Extrapolation unavailable: insufficient or suppressed evidence.'}</p>}
      </article>}
    </>}
  </section>
}
