// Deterministic unit tests for alert-priority-engine.js, matching the radar-worker/
// worker.test.cjs convention (node:test, no new dependency).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./alert-priority-engine.js');

const NOW = Date.parse('2026-06-01T18:00:00Z');
const HOUR = 3600 * 1000;

function loc(lat, lon, ageMs) {
  return { lat, lon, observedAt: NOW - (ageMs || 0) };
}

// A simple square polygon roughly covering lon [-98,-97], lat [38,39] (GeoJSON [lon,lat] order).
const SQUARE = {
  type: 'Polygon',
  coordinates: [[[-98, 38], [-97, 38], [-97, 39], [-98, 39], [-98, 38]]],
};
// A square with a hole cut out of its center.
const SQUARE_WITH_HOLE = {
  type: 'Polygon',
  coordinates: [
    [[-98, 38], [-96, 38], [-96, 40], [-98, 40], [-98, 38]], // outer
    [[-97.6, 38.4], [-96.4, 38.4], [-96.4, 39.6], [-97.6, 39.6], [-97.6, 38.4]], // hole
  ],
};
const MULTI = {
  type: 'MultiPolygon',
  coordinates: [
    [[[-98, 38], [-97, 38], [-97, 39], [-98, 39], [-98, 38]]],
    [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  ],
};

const INSIDE = loc(38.5, -97.5, 0);
const OUTSIDE = loc(35, -90, 0);

function candidate(overrides) {
  return Object.assign({
    id: 'c1',
    type: 'severeThunderstormWarning',
    source: 'nws-alert',
    title: null,
    subtitle: null,
    issuedAt: NOW - HOUR,
    effectiveAt: NOW - HOUR,
    expiresAt: NOW + HOUR,
    geometry: SQUARE,
    relevanceMode: 'geometry',
    modifiers: [],
    cancelled: false,
  }, overrides);
}

// --- Point-in-polygon -------------------------------------------------------------------

test('pointInGeometry: Polygon inside/outside', () => {
  assert.equal(engine.pointInGeometry(INSIDE, SQUARE), true);
  assert.equal(engine.pointInGeometry(OUTSIDE, SQUARE), false);
});

test('pointInGeometry: MultiPolygon matches either member polygon', () => {
  assert.equal(engine.pointInGeometry(INSIDE, MULTI), true);
  assert.equal(engine.pointInGeometry({ lat: 10.5, lon: 10.5 }, MULTI), true);
  assert.equal(engine.pointInGeometry(OUTSIDE, MULTI), false);
});

test('pointInGeometry: polygon holes are excluded', () => {
  const insideHole = { lat: 39, lon: -97 };
  const insideOuterNotHole = { lat: 38.2, lon: -97.5 };
  assert.equal(engine.pointInGeometry(insideHole, SQUARE_WITH_HOLE), false);
  assert.equal(engine.pointInGeometry(insideOuterNotHole, SQUARE_WITH_HOLE), true);
});

test('pointInGeometry: null/missing geometry or point is false, never throws', () => {
  assert.equal(engine.pointInGeometry(INSIDE, null), false);
  assert.equal(engine.pointInGeometry(null, SQUARE), false);
  assert.equal(engine.pointInGeometry(INSIDE, { type: 'Point', coordinates: [0, 0] }), false);
});

// --- Location freshness -----------------------------------------------------------------

test('classifyLocationFreshness: fresh/aging/stale/unavailable thresholds', () => {
  assert.equal(engine.classifyLocationFreshness(loc(0, 0, 5000), NOW), 'fresh');
  assert.equal(engine.classifyLocationFreshness(loc(0, 0, 30000), NOW), 'aging');
  assert.equal(engine.classifyLocationFreshness(loc(0, 0, 120000), NOW), 'stale');
  assert.equal(engine.classifyLocationFreshness(loc(0, 0, 600000), NOW), 'unavailable');
  assert.equal(engine.classifyLocationFreshness(null, NOW), 'unavailable');
  assert.equal(engine.classifyLocationFreshness({ lat: 0, lon: 0 }, NOW), 'unavailable');
});

// --- Active/expired/cancelled -------------------------------------------------------------

test('resolveSelectedContext: expired candidate excluded', () => {
  const c = candidate({ expiresAt: NOW - 1000 });
  const result = engine.resolveSelectedContext([c], INSIDE, NOW);
  assert.equal(result.selected, null);
});

test('resolveSelectedContext: cancelled candidate excluded even if not expired', () => {
  const c = candidate({ cancelled: true });
  const result = engine.resolveSelectedContext([c], INSIDE, NOW);
  assert.equal(result.selected, null);
});

test('resolveSelectedContext: candidate with no expiresAt (null) never excluded by expiry', () => {
  const c = candidate({ expiresAt: null, relevanceMode: 'always', geometry: null });
  const result = engine.resolveSelectedContext([c], INSIDE, NOW);
  assert.equal(result.selected.id, 'c1');
});

// --- Relevance: geometry vs outside, location freshness gating ---------------------------

test('resolveSelectedContext: outside geometry -> not relevant, falls to baseline', () => {
  const c = candidate({});
  const result = engine.resolveSelectedContext([c], OUTSIDE, NOW);
  assert.equal(result.selected, null);
  assert.equal(result.relevantCount, 0);
});

test('resolveSelectedContext: stale location never grants a NEW geometry-based promotion', () => {
  const c = candidate({});
  const staleLoc = loc(38.5, -97.5, 120000); // inside geometry, but stale
  const result = engine.resolveSelectedContext([c], staleLoc, NOW);
  assert.equal(result.selected, null);
  assert.equal(result.locationFreshness, 'stale');
});

test('resolveSelectedContext: unavailable location never grants a geometry-based promotion', () => {
  const c = candidate({});
  const result = engine.resolveSelectedContext([c], null, NOW);
  assert.equal(result.selected, null);
  assert.equal(result.locationFreshness, 'unavailable');
});

test('resolveSelectedContext: fresh location inside geometry is relevant', () => {
  const c = candidate({});
  const result = engine.resolveSelectedContext([c], INSIDE, NOW);
  assert.equal(result.selected.id, 'c1');
});

test('resolveSelectedContext: aging location inside geometry is still authoritative', () => {
  const c = candidate({});
  const aging = loc(38.5, -97.5, 30000);
  const result = engine.resolveSelectedContext([c], aging, NOW);
  assert.equal(result.selected.id, 'c1');
});

// --- Priority ordering / promotion --------------------------------------------------------

test('resolveSelectedContext: Tornado Warning outranks Severe Thunderstorm Warning', () => {
  const svr = candidate({ id: 'svr1', type: 'severeThunderstormWarning' });
  const tor = candidate({ id: 'tor1', type: 'tornadoWarning' });
  const result = engine.resolveSelectedContext([svr, tor], INSIDE, NOW);
  assert.equal(result.selected.id, 'tor1');
  assert.equal(result.selected.type, 'tornadoWarning');
});

test('resolveSelectedContext: PDS modifier resolves to the more specific type and outranks plain warning', () => {
  const plain = candidate({ id: 'tor1', type: 'tornadoWarning' });
  const pds = candidate({ id: 'tor2', type: 'tornadoWarning', modifiers: ['pds'] });
  const result = engine.resolveSelectedContext([plain, pds], INSIDE, NOW);
  assert.equal(result.selected.id, 'tor2');
  assert.equal(result.selected.type, 'tornadoWarningPds');
});

test('resolveSelectedContext: Tornado Watch outranks SPC categorical outlook', () => {
  const outlook = candidate({ id: 'spc1', type: 'spcOutlook', relevanceMode: 'always', geometry: null });
  const watch = candidate({ id: 'watch1', type: 'tornadoWatch' });
  const result = engine.resolveSelectedContext([outlook, watch], INSIDE, NOW);
  assert.equal(result.selected.id, 'watch1');
});

test('resolveSelectedContext: unrecognized type is ignored, never selected', () => {
  const bogus = candidate({ id: 'bogus1', type: 'not-a-real-type' });
  const result = engine.resolveSelectedContext([bogus], INSIDE, NOW);
  assert.equal(result.selected, null);
});

// --- Deterministic tie-break, including reversed input ------------------------------------

test('resolveSelectedContext: same-priority tie-break is deterministic and order-independent', () => {
  const a = candidate({ id: 'aaa', type: 'severeThunderstormWarning', effectiveAt: NOW - HOUR });
  const b = candidate({ id: 'bbb', type: 'severeThunderstormWarning', effectiveAt: NOW - HOUR });
  const forward = engine.resolveSelectedContext([a, b], INSIDE, NOW);
  const reversed = engine.resolveSelectedContext([b, a], INSIDE, NOW);
  assert.equal(forward.selected.id, reversed.selected.id);
  assert.equal(forward.selected.id, 'aaa'); // lexically first id is the final fallback tie-break
});

test('resolveSelectedContext: tie-break prefers newer effectiveAt over older, regardless of input order', () => {
  const older = candidate({ id: 'z-old', type: 'severeThunderstormWarning', effectiveAt: NOW - 2 * HOUR });
  const newer = candidate({ id: 'a-new', type: 'severeThunderstormWarning', effectiveAt: NOW - HOUR });
  const forward = engine.resolveSelectedContext([older, newer], INSIDE, NOW);
  const reversed = engine.resolveSelectedContext([newer, older], INSIDE, NOW);
  assert.equal(forward.selected.id, 'a-new');
  assert.equal(reversed.selected.id, 'a-new');
});

test('resolveSelectedContext: tie-break prefers more modifiers (more specific/severe) over fewer', () => {
  const plain = candidate({ id: 'plain1', type: 'severeThunderstormWarning', effectiveAt: NOW - HOUR });
  const destructive = candidate({ id: 'destructive1', type: 'severeThunderstormWarning', modifiers: ['destructive'], effectiveAt: NOW - HOUR });
  const result = engine.resolveSelectedContext([plain, destructive], INSIDE, NOW);
  assert.equal(result.selected.id, 'destructive1');
  assert.equal(result.selected.type, 'severeThunderstormWarningDestructive');
});

// --- Moving-chaser matrix (subset of Parts A-L, via direct resolveSelectedContext calls) --

test('moving-chaser: outside all candidates -> baseline (null selected)', () => {
  const svr = candidate({ id: 'svr1' });
  const result = engine.resolveSelectedContext([svr], OUTSIDE, NOW);
  assert.equal(result.selected, null);
});

test('moving-chaser: drive into SVR polygon -> promoted', () => {
  const svr = candidate({ id: 'svr1' });
  const result = engine.resolveSelectedContext([svr], INSIDE, NOW);
  assert.equal(result.selected.id, 'svr1');
});

test('moving-chaser: drive into overlapping TOR within the same SVR -> TOR promoted over SVR', () => {
  const svr = candidate({ id: 'svr1', type: 'severeThunderstormWarning' });
  const tor = candidate({ id: 'tor1', type: 'tornadoWarning' });
  const result = engine.resolveSelectedContext([svr, tor], INSIDE, NOW);
  assert.equal(result.selected.id, 'tor1');
});

test('moving-chaser: TOR expires while still in SVR -> falls back to SVR, not baseline', () => {
  const svr = candidate({ id: 'svr1', type: 'severeThunderstormWarning' });
  const torExpired = candidate({ id: 'tor1', type: 'tornadoWarning', expiresAt: NOW - 1000 });
  const result = engine.resolveSelectedContext([svr, torExpired], INSIDE, NOW);
  assert.equal(result.selected.id, 'svr1');
});

test('moving-chaser: exit SVR polygon while a Watch still covers the point -> falls back to Watch', () => {
  const watch = candidate({ id: 'watch1', type: 'severeThunderstormWatch', geometry: MULTI });
  // chaser exited the SVR-only polygon (SQUARE) but the wider Watch geometry (MULTI, includes SQUARE) still covers them
  const result = engine.resolveSelectedContext([watch], INSIDE, NOW);
  assert.equal(result.selected.id, 'watch1');
});

test('moving-chaser: warning cancelled early -> immediate fallback to next-highest-still-relevant', () => {
  const watch = candidate({ id: 'watch1', type: 'tornadoWatch' });
  const torCancelled = candidate({ id: 'tor1', type: 'tornadoWarning', cancelled: true });
  const result = engine.resolveSelectedContext([watch, torCancelled], INSIDE, NOW);
  assert.equal(result.selected.id, 'watch1');
});

test('moving-chaser: GPS goes stale while a warning is active -> conservative retention is caller responsibility, engine itself returns null for a stale re-check', () => {
  const svr = candidate({ id: 'svr1' });
  const staleLoc = loc(38.5, -97.5, 120000);
  const result = engine.resolveSelectedContext([svr], staleLoc, NOW);
  // Documented behavior: the engine never re-confirms geometry relevance on stale location.
  // A caller wanting "conservative retention" must hold onto the PREVIOUS selected result
  // itself while location is stale (not re-derive it from this call) -- see the module's
  // Part 2 doc comment.
  assert.equal(result.selected, null);
  assert.equal(result.locationFreshness, 'stale');
});

test('moving-chaser: fresh location returns after a stale gap -> resumes normal geometry-based selection', () => {
  const svr = candidate({ id: 'svr1' });
  const fresh = loc(38.5, -97.5, 0);
  const result = engine.resolveSelectedContext([svr], fresh, NOW);
  assert.equal(result.selected.id, 'svr1');
});

// --- Source-outage / network-failure semantics (caller-composition contract) --------------

test('source outage semantics: empty candidate list is indistinguishable from "no alerts" at this layer (documented caller responsibility)', () => {
  const result = engine.resolveSelectedContext([], INSIDE, NOW);
  assert.equal(result.selected, null);
  assert.equal(result.candidateCount, 0);
  // This proves the engine itself does not fabricate a distinction between "fetched
  // successfully, zero relevant alerts" and "fetch failed" -- callers must pass the
  // last-known-valid candidate list themselves during an outage (bounded by each
  // candidate's own expiresAt, which this function still enforces normally).
});

// --- Full promotion/demotion chain qualification (V1.3 Part G/H) -------------------------
// One evolving pool of candidates, re-resolved at each step exactly the way the real overlay
// re-resolves on every poll -- no separate "advance to next state" API, since the whole point
// of a pure resolver is that promotion/demotion/fallback all fall out of calling it again with
// the world's current, honest state. Steps 1-7 build up (SPC -> Watch -> escalating Watch ->
// SVR -> TOR -> elevated TOR), 8-12 tear down in reverse (elevated removed -> TOR expires ->
// SVR expires -> Watch ends -> SPC). Mesoscale Discussion is intentionally absent from this
// chain -- no MD candidate source exists yet (see classic-v2.html's own documented Part B
// limitation) -- so this matrix goes straight from Watch to SPC on the way down, which is
// itself the correct, honestly-documented behavior for what's actually implemented.
test('full chain: SPC -> Watch -> escalate -> SVR -> TOR -> elevated -> reverse -> SPC', () => {
  const spc = candidate({ id: 'spc-day1', type: 'spcOutlook', relevanceMode: 'always', geometry: null, expiresAt: null });
  const svrWatch = candidate({ id: 'svrwatch1', type: 'severeThunderstormWatch' });
  const torWatch = candidate({ id: 'torwatch1', type: 'tornadoWatch' });
  const svr = candidate({ id: 'svr1', type: 'severeThunderstormWarning' });
  const tor = candidate({ id: 'tor1', type: 'tornadoWarning' });
  const torPds = candidate({ id: 'tor1', type: 'tornadoWarning', modifiers: ['pds'] }); // same real-world warning, PDS added

  // 1. Only SPC in the pool -> SPC baseline.
  let pool = [spc];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.type, 'spcOutlook');

  // 2. A Severe Thunderstorm Watch becomes active -> outranks SPC.
  pool = [spc, svrWatch];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'svrwatch1');

  // 3. Escalates to a Tornado Watch (both active -- e.g. SVR watch upgraded) -> TOR Watch wins.
  pool = [spc, svrWatch, torWatch];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'torwatch1');

  // 4. A real Severe Thunderstorm Warning fires inside the watch -> SVR outranks both watches.
  pool = [spc, svrWatch, torWatch, svr];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'svr1');

  // 5. A Tornado Warning fires -> outranks the SVR.
  pool = [spc, svrWatch, torWatch, svr, tor];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'tor1');
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.type, 'tornadoWarning');

  // 6/7. That same warning gets a PDS tag (authoritative escalation, same id) -> elevated type.
  pool = [spc, svrWatch, torWatch, svr, torPds];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.type, 'tornadoWarningPds');

  // 8. PDS tag removed (still the same warning, now plain again) -> ordinary TOR.
  pool = [spc, svrWatch, torWatch, svr, tor];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.type, 'tornadoWarning');

  // 9. TOR expires/exits (removed from the active pool) -> falls back to SVR, not baseline.
  pool = [spc, svrWatch, torWatch, svr];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'svr1');

  // 10. SVR expires/exits -> falls back to the (still-elevated) Tornado Watch.
  pool = [spc, svrWatch, torWatch];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'torwatch1');

  // 11. Tornado Watch ends -> falls back to the Severe Thunderstorm Watch.
  pool = [spc, svrWatch];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id, 'svrwatch1');

  // 12. That watch ends too -> falls back to SPC (no MD source in this build -- documented).
  pool = [spc];
  assert.equal(engine.resolveSelectedContext(pool, INSIDE, NOW).selected.type, 'spcOutlook');
});

test('full chain reversed candidate array order at every step produces identical winners', () => {
  const spc = candidate({ id: 'spc-day1', type: 'spcOutlook', relevanceMode: 'always', geometry: null, expiresAt: null });
  const svrWatch = candidate({ id: 'svrwatch1', type: 'severeThunderstormWatch' });
  const tor = candidate({ id: 'tor1', type: 'tornadoWarning' });
  const pool = [spc, svrWatch, tor];
  const forward = engine.resolveSelectedContext(pool, INSIDE, NOW).selected.id;
  const reversed = engine.resolveSelectedContext([...pool].reverse(), INSIDE, NOW).selected.id;
  assert.equal(forward, reversed);
  assert.equal(forward, 'tor1');
});

// --- SPC geometry-based relevance (Part A: SPC now goes through the same pointInGeometry) --

test('SPC categorical candidate only relevant when the chaser point is inside its actual risk polygon', () => {
  const spcGeom = candidate({ id: 'spc-day1', type: 'spcOutlook', geometry: SQUARE, relevanceMode: 'geometry', expiresAt: null });
  const inResult = engine.resolveSelectedContext([spcGeom], INSIDE, NOW);
  const outResult = engine.resolveSelectedContext([spcGeom], OUTSIDE, NOW);
  assert.equal(inResult.selected.type, 'spcOutlook');
  assert.equal(outResult.selected, null);
});

// --- Purity / determinism ------------------------------------------------------------------

test('resolveSelectedContext: pure - same inputs always produce the same output', () => {
  const candidates = [
    candidate({ id: 'a', type: 'severeThunderstormWarning' }),
    candidate({ id: 'b', type: 'tornadoWatch', geometry: MULTI }),
  ];
  const r1 = engine.resolveSelectedContext(candidates, INSIDE, NOW);
  const r2 = engine.resolveSelectedContext(candidates, INSIDE, NOW);
  assert.deepEqual(r1, r2);
});

test('ALERT_TYPES: every entry has well-formed priority/presentationRole fields, ordered by ascending priority number', () => {
  // tornadoWarningPds and tornadoWarningObserved intentionally share priority 1 -- both are
  // modifier-resolved variants of the same base tornadoWarning entry, tie-broken by
  // modifier-count/time/id like any other same-priority pair (see the tie-break tests above),
  // not by inventing a fabricated ranking between two authoritative-but-incomparable modifiers.
  let lastPriority = -1;
  for (const key of Object.keys(engine.ALERT_TYPES)) {
    const t = engine.ALERT_TYPES[key];
    assert.equal(typeof t.priority, 'number');
    assert.equal(typeof t.presentationRole, 'string');
    assert.ok(t.priority >= lastPriority, `${key} (priority ${t.priority}) is out of order`);
    lastPriority = t.priority;
  }
});
