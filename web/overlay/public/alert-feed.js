// Shared NWS alert classification logic -- the one place this exists now, loaded by both
// classic.html and classic-v2.html via <script src="alert-feed.js">. Ported verbatim from
// classic.html's own inline copy (see git history there for the original). Extracted because
// classic-alt.html already had its own stale, drifted duplicate of alertClassFor (event-name-only,
// missing PDS/Emergency/Considerable/Destructive detection) -- proof this logic diverges silently
// if copy-pasted instead of shared.
//
// Plain (non-module) global-scope script: every top-level const/function here becomes visible to
// any later <script> tag in the same document (classic scripts share one global lexical scope),
// so the consuming page's own inline script can call these directly with no import/export.

// Takes the whole feature (not just the event name) because PDS/Tornado Emergency/Considerable/
// Destructive are never their own NWS `event` string -- Tornado Warning stays "Tornado Warning"
// even at Tornado Emergency severity. NWS conveys the escalation through structured CAP parameters
// instead: tornadoDamageThreat ("CONSIDERABLE" = PDS, "CATASTROPHIC" = Tornado Emergency) and
// thunderstormDamageThreat ("CONSIDERABLE"/"DESTRUCTIVE" for severe t-storm). Falls back to
// searching the free-text headline/description for "PARTICULARLY DANGEROUS SITUATION" / "TORNADO
// EMERGENCY" in case the structured field is ever missing but the text flag is present -- never
// fabricates an escalation neither signal actually shows.
function alertClassFor(feature) {
  const props = feature?.properties || {};
  const text = String(props.event || '').toLowerCase();
  const params = props.parameters || {};
  const firstOf = (value) => (Array.isArray(value) ? value[0] : value) || '';
  const tornadoThreat = String(firstOf(params.tornadoDamageThreat)).toUpperCase();
  const stormThreat = String(firstOf(params.thunderstormDamageThreat)).toUpperCase();
  const freeText = `${props.headline || ''} ${props.description || ''}`.toUpperCase();

  if (text.includes('tornado warning')) {
    if (tornadoThreat === 'CATASTROPHIC' || freeText.includes('TORNADO EMERGENCY')) return 'tor-emergency';
    if (tornadoThreat === 'CONSIDERABLE' || freeText.includes('PARTICULARLY DANGEROUS SITUATION')) return 'tor-pds';
    return 'tor-warning';
  }
  if (text.includes('severe thunderstorm warning')) {
    if (stormThreat === 'DESTRUCTIVE') return 'svr-destructive';
    if (stormThreat === 'CONSIDERABLE') return 'svr-considerable';
    return 'svr-warning';
  }
  if (text.includes('flash flood warning')) return 'ffw-warning';
  // Excessive Heat Warning is the actual warning-tier heat product (there's no plain "Heat
  // Warning"); Heat Advisory and Excessive Heat Watch both get the lighter advisory-weight color --
  // a heat watch isn't materially different from an advisory the way a tornado watch is from a
  // warning.
  if (text.includes('excessive heat warning')) return 'heat-warning';
  if (text.includes('heat advisory') || text.includes('excessive heat watch')) return 'heat-advisory';
  if (text.includes('tornado watch')) return 'tor-watch';
  if (text.includes('severe thunderstorm watch')) return 'svr-watch';
  if (text.includes('flash flood watch')) return 'ffw-watch';
  return 'generic';
}

// Warning-tier alerts a real polygon boundary/countdown/radar-mode reaction apply to -- watches
// and generic are excluded. heat-warning is included even though NWS heat products never actually
// carry polygon geometry -- drawing code just draws nothing when geometry is null, so including it
// costs nothing.
const WARNING_TIER_CLASSES = ['tor-emergency', 'tor-pds', 'tor-warning', 'svr-destructive', 'svr-considerable', 'svr-warning', 'ffw-warning', 'heat-warning'];

// Tornado Emergency obviously outranks everything; the rest escalate within their own family (PDS
// above plain tor-warning, destructive/considerable above plain severe) before falling to NWS's own
// severity convention (warnings before watches, tornado before severe before flash flood before
// heat). generic sits below every real hazard tier (it's a catch-all for whatever NWS product
// isn't otherwise classified) but still outranks clear/no-alert.
const ALERT_SEVERITY_ORDER = ['tor-emergency', 'tor-pds', 'tor-warning', 'svr-destructive', 'svr-considerable', 'svr-warning', 'ffw-warning', 'heat-warning', 'tor-watch', 'svr-watch', 'ffw-watch', 'heat-advisory', 'generic'];
function severityRank(cls) {
  const i = ALERT_SEVERITY_ORDER.indexOf(cls);
  return i === -1 ? ALERT_SEVERITY_ORDER.length : i;
}

// NWS's VTEC string (properties.parameters.VTEC[0]) carries the real, official sequential event
// number for that alert type/office this year -- e.g.
// "/O.NEW.KOUN.TO.W.0042.260908T0815Z-260908T0900Z/" -> 0042. The action field (NEW/CON/EXT/EXA/
// EXB/UPG/CAN/EXP/COR/ROU) is always exactly 3 letters.
function vtecEventNumber(feature) {
  const vtec = feature?.properties?.parameters?.VTEC;
  const first = Array.isArray(vtec) ? vtec[0] : null;
  if (!first) return null;
  const match = first.match(/\.\w{3}\.\w{4}\.\w{2}\.\w\.(\d{3,4})\./);
  return match ? match[1] : null;
}

// NWS's own `event` field never changes for an escalated tier (Tornado Warning stays "Tornado
// Warning" whether or not it's PDS/Emergency) -- this is the actual label text for the tiers that
// need one; anything not listed here just uses its own event name.
const ALERT_TIER_LABELS = {
  'tor-emergency': 'TORNADO EMERGENCY',
  'tor-pds': 'PDS TORNADO WARNING',
  'svr-destructive': 'DESTRUCTIVE T-STORM WARNING',
  'svr-considerable': 'CONSIDERABLE T-STORM WARNING',
};

// Test-only: builds a fake NWS feature (including the real tornadoDamageThreat/
// thunderstormDamageThreat CAP parameters for the escalated tiers, not a separate shortcut) so a
// ?simulateAlert=<kind> test harness can feed it through the exact same classify/map/render path a
// real fetch would. Requires the host page to have already declared its own `settings` object
// (for a fallback lat/lon on the fabricated polygon) by the time this is actually called -- both
// classic.html and classic-v2.html define settings before any alert code runs, so this is safe
// even though it's referenced here before that script block exists on the page.
// generic (added for classic-v2.html's new 13th tier) uses a real but otherwise-unmapped NWS
// product -- Winter Storm Warning -- as its test case.
function simulatedAlertFeature(kind) {
  const config = {
    'tor-warning': { event: 'Tornado Warning' },
    'tor-pds': { event: 'Tornado Warning', parameters: { tornadoDamageThreat: ['CONSIDERABLE'] } },
    'tor-emergency': { event: 'Tornado Warning', parameters: { tornadoDamageThreat: ['CATASTROPHIC'] } },
    'svr-warning': { event: 'Severe Thunderstorm Warning' },
    'svr-considerable': { event: 'Severe Thunderstorm Warning', parameters: { thunderstormDamageThreat: ['CONSIDERABLE'] } },
    'svr-destructive': { event: 'Severe Thunderstorm Warning', parameters: { thunderstormDamageThreat: ['DESTRUCTIVE'] } },
    'ffw-warning': { event: 'Flash Flood Warning' },
    'heat-warning': { event: 'Excessive Heat Warning' },
    'heat-advisory': { event: 'Heat Advisory' },
    'tor-watch': { event: 'Tornado Watch' },
    'svr-watch': { event: 'Severe Thunderstorm Watch' },
    'ffw-watch': { event: 'Flash Flood Watch' },
    'generic': { event: 'Winter Storm Warning' },
  }[kind];
  if (!config) return null;
  const now = new Date();
  const feature = {
    properties: {
      id: `urn:oid:simulated.${kind}`,
      event: config.event,
      areaDesc: 'Benton; Washington',
      sent: now.toISOString(),
      expires: new Date(now.getTime() + 30 * 60_000).toISOString(),
      parameters: { VTEC: ['/O.NEW.KOUN.XX.W.0099.260908T1200Z-260908T1300Z/'], ...(config.parameters || {}) },
    },
  };
  // Storm-based warnings (tornado/severe/flash flood, any tier) carry a real polygon in NWS's own
  // feed -- simulate one too, an irregular shape (real warning polygons are never neat rectangles)
  // deliberately NOT centered on the position so the dot sits inside it off-center, the way a real
  // one would.
  if (WARNING_TIER_CLASSES.includes(alertClassFor(feature))) {
    const lon = (typeof settings !== 'undefined' && settings.longitude) ?? -97.5;
    const lat = (typeof settings !== 'undefined' && settings.latitude) ?? 35.5;
    feature.geometry = {
      type: 'Polygon',
      coordinates: [[
        [lon - 0.28, lat - 0.10],
        [lon - 0.05, lat - 0.22],
        [lon + 0.20, lat - 0.06],
        [lon + 0.16, lat + 0.18],
        [lon - 0.10, lat + 0.20],
        [lon - 0.28, lat - 0.10],
      ]],
    };
  }
  return feature;
}
