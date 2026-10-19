// Presentation boundary: conservatively age received metadata, never compute tracks or motion.
import {projectTrackingResearch} from '../../../../shared/trackingResearchContract.mjs';
export function trackingView(snapshot, {site, product, frameId, mode='HISTORICAL_REPLAY', elapsedMs=0} = {}) {
  if (!snapshot) return {available:false, reason:'No tracking evidence supplied.'};
  const publisher=snapshot.publisherVersion!==undefined;
  if(publisher){
    try{snapshot=projectTrackingResearch(snapshot,{mode})}catch{return {available:false,reason:'Invalid publisher research evidence or evaluation mode.'}}
  }else if(mode!=='HISTORICAL_REPLAY')return {available:false,reason:'Installed research publisher evidence is unavailable.'};
  const bridge = snapshot.bridgeSchema !== undefined;
  if (bridge && (snapshot.bridgeSchema !== 'codeblack.native-cache-tracking.v1' || snapshot.productionIntegrated !== publisher))
    return {available:false, reason:'Unsupported native-cache bridge contract or integration state.'};
  if (bridge && snapshot.operational === false && snapshot.state === 'SUPPRESSED')
    return {available:false, generation:snapshot.producerGeneration, reason:`Native-cache tracking suppressed: ${Array.isArray(snapshot.suppressionReasons)?snapshot.suppressionReasons.join('; '):'Evidence unavailable'}`};
  if (snapshot.schema !== 'codeblack.radar-tracks.v0' || snapshot.algorithm !== 'REF_REGION_MUTUAL_UNIQUE_V0' ||
      snapshot.operational !== false || snapshot.scientificallyQualified !== false || snapshot.mode !== mode)
    return {available:false, reason:'Unsupported contract or mode. Live integration is unavailable.'};
  const source = snapshot.frames?.[0];
  if (!source || source.site !== site || source.product !== product || source.frameId !== frameId ||
      source.cut !== 1 || source.ordinal !== 1 || !Number.isFinite(Date.parse(source.end)) ||
      !Number.isFinite(Date.parse(snapshot.evaluationAt)) || !Array.isArray(snapshot.tracks))
    return {available:false, reason:'Tracking evidence does not match the selected source frame.'};
  if (!['RESEARCH_OBSERVATIONS_AVAILABLE','STALE_OBSERVATIONS_ONLY','SUPPRESSED'].includes(snapshot.state))
    return {available:false, reason:'Unsupported tracking evidence state.'};
  const reasons = Array.isArray(snapshot.suppressionReasons) ? snapshot.suppressionReasons : [];
  let catalog = [];
  if (bridge) {
    catalog = snapshot.inputFrameCatalog;
    const hex = /^[a-f0-9]{64}$/;
    if (snapshot.sourceState !== 'CACHED_NATIVE_RETAINED' || snapshot.currentFrameId !== frameId ||
        !Array.isArray(catalog) || catalog.length < 1 || catalog.length > 6 ||
        new Set(catalog.map(record=>record?.frameId)).size !== catalog.length ||
        !catalog.every(record=>record && /^[a-f0-9]{24}$/.test(record.frameId) &&
          record.site === site && record.origin?.id === site && record.product === 'REF' && record.units === 'dBZ' &&
          record.cut === 1 && record.ordinal === 1 && hex.test(record.sourceSha256) && hex.test(record.nativeContentSha256) &&
          record.renderContract === source.renderContract && record.analysisDomain?.crs === 'EPSG:3857' &&
          Number.isFinite(record.start) && Number.isFinite(record.end) && record.start <= record.end &&
          Number.isFinite(record.origin?.lat) && Math.abs(record.origin.lat)<85 &&
          Number.isFinite(record.origin?.lon) && Math.abs(record.origin.lon)<=180))
      return {available:false, reason:'Native-cache provenance catalog is incomplete or incompatible.'};
    const current = catalog.find(record=>record.frameId === frameId);
    if (!current || current.end !== Date.parse(source.end) || current.start !== Date.parse(source.start) ||
        current.sourceSha256 !== source.sourceSha256 || current.nativeContentSha256 !== source.nativeContentSha256 ||
        !snapshot.tracks.every(track=>Array.isArray(track?.history) && track.history.every(point=>
          catalog.some(record=>record.frameId===point.frameId && record.end===Date.parse(point.time)))))
      return {available:false, reason:'Tracking history or current frame does not resolve to retained native-cache provenance.'};
  }
  const tracks = snapshot.state === 'SUPPRESSED' ? [] : snapshot.tracks.filter(track =>
    track && typeof track.id === 'string' && track.confidence === 'UNQUALIFIED' && Array.isArray(track.history) &&
    track.history.length > 0 && track.history.length <= 6 && track.history.every(point =>
      Number.isFinite(Date.parse(point.time)) && typeof point.frameId === 'string' &&
      Number.isFinite(point.position?.lat) && Number.isFinite(point.position?.lon)));
  if(!Number.isFinite(elapsedMs)||elapsedMs<0)return {available:false,reason:'Reader age clock is unavailable.'};
  const age = snapshot.freshness?.sourceAgeSeconds + (mode==='LIVE_CLOCK_RESEARCH'?elapsedMs/1000:0);
  const fresh = snapshot.state === 'RESEARCH_OBSERVATIONS_AVAILABLE' && Number.isFinite(age) && age >= 0 && age <= 120;
  return {available:true, source, tracks, fresh, age, reasons, bridge, catalog, publisher, generation:snapshot.producerGeneration, liveClock:mode==='LIVE_CLOCK_RESEARCH', state:age>120?'STALE_OBSERVATIONS_ONLY':snapshot.state,
    evaluationAt:snapshot.evaluationAt, wallClockGeneratedAt:snapshot.wallClockGeneratedAt};
}

export function replayMotion(track, view) {
  const motion = track?.motion;
  return view.fresh && motion?.kind === 'OBSERVED_CENTROID_DISPLACEMENT' &&
    motion.directionConvention === 'TOWARD_TRUE_NORTH_CLOCKWISE' &&
    Number.isFinite(motion.speedMetersPerSecond) && motion.speedMetersPerSecond >= 0 &&
    (motion.directionToDegrees === null || (Number.isFinite(motion.directionToDegrees) && motion.directionToDegrees >= 0 && motion.directionToDegrees < 360)) ? motion : null;
}

export function replayExtrapolation(track, view) {
  const estimate = track?.extrapolation;
  return !view.publisher && !view.liveClock && view.fresh && replayMotion(track, view) && track.history.length >= 3 &&
    estimate?.kind === 'LINEAR_EXTRAPOLATION' && estimate.use === 'REPLAY_ONLY' &&
    estimate.uncertainty?.kind === 'HEURISTIC_NOT_PROBABILITY' &&
    Number.isFinite(estimate.uncertainty.radiusMeters) && estimate.uncertainty.radiusMeters >= 0 &&
    Number.isFinite(Date.parse(estimate.validTime)) && Number.isFinite(Date.parse(estimate.referenceTime)) &&
    estimate.leadSeconds > 0 && estimate.leadSeconds <= 300 &&
    Date.parse(estimate.validTime) - Date.parse(estimate.referenceTime) === estimate.leadSeconds * 1000 &&
    Date.parse(estimate.referenceTime) === Date.parse(view.source.end) &&
    Number.isFinite(estimate.position?.lat) && Number.isFinite(estimate.position?.lon) ? estimate : null;
}
