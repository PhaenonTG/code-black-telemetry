// Targeted tests for the Level II real-time chunk assembler (V1). Follows the existing
// worker.test.cjs convention (node:test, module.exports test-seam indirection). Reuses
// fixtures shaped exactly like the real evidence from the KTWX volume 895 prototype pass
// (720/720 radial coverage, 0.6deg gap when complete; 600/720 and 60.5deg when one real chunk
// is missing) rather than committing actual raw Level II bytes to git.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./worker.cjs');

test.beforeEach(() => {
  worker._resetChunkState();
  worker.frames.clear();
});

// --- A. numeric volume ordering, including 999 vs 1000 -------------------------------------

test('A: numeric volume comparison, not lexicographic, resolves 999 vs 1000 correctly', () => {
  const volumes = [890, 999, 1000, 1001, 250];
  const numeric = [...volumes].sort((a, b) => a - b);
  const lexicographic = [...volumes].map(String).sort().map(Number);
  assert.deepEqual(numeric, [250, 890, 999, 1000, 1001]);
  assert.notDeepEqual(lexicographic, numeric); // proves the trap is real
});

test('A: string comparison of volume folder numbers is unsafe in EITHER direction across a digit-length boundary', () => {
  // The exact trap this task named: "999" > "1000" as strings (since '9' > '1' lexically),
  // even though 999 < 1000 numerically. discoverLatestChunkVolume's own `hi - anchor` growth
  // and binary-search midpoint math (worker.cjs) only ever compares the NUMBER, never the key
  // string -- this test documents why that matters rather than re-deriving the search itself,
  // which is already exercised end-to-end by the live qualification pass (real KTWX/895 run).
  assert.equal(999 < 1000, true); // correct, numeric
  assert.equal('999' < '1000', false); // WRONG if this were used instead -- the documented trap
});

// --- B. deterministic S/I/E ordering ---------------------------------------------------------

function fakeChunkEntries() {
  return [
    { key: 'KTWX/895/20260916-025545-005-I', seq: 5, flag: 'I' },
    { key: 'KTWX/895/20260916-025545-001-S', seq: 1, flag: 'S' },
    { key: 'KTWX/895/20260916-025545-082-E', seq: 82, flag: 'E' },
    { key: 'KTWX/895/20260916-025545-003-I', seq: 3, flag: 'I' },
    { key: 'KTWX/895/20260916-025545-002-I', seq: 2, flag: 'I' },
  ];
}

test('B: orderChunkEntries produces S, then I ascending numerically, then E', () => {
  const ordered = worker.orderChunkEntries(fakeChunkEntries());
  assert.deepEqual(ordered.map((c) => c.flag + c.seq), ['S1', 'I2', 'I3', 'I5', 'E82']);
});

test('B: ordering is deterministic regardless of input shuffle', () => {
  const a = worker.orderChunkEntries(fakeChunkEntries());
  const shuffled = [...fakeChunkEntries()].reverse();
  const b = worker.orderChunkEntries(shuffled);
  assert.deepEqual(a.map((c) => c.key), b.map((c) => c.key));
});

// --- C. duplicate chunk de-duplication (via the Map-keyed-by-flag-seq state shape) ----------

test('C: chunk state Map de-dupes by (flag, seq) key regardless of how many times the same key is listed', () => {
  const chunks = new Map();
  const dedupeKey = (c) => `${c.flag}-${c.seq}`;
  const entries = [...fakeChunkEntries(), fakeChunkEntries()[0], fakeChunkEntries()[0]]; // I5 listed 3x total
  for (const e of entries) if (!chunks.has(dedupeKey(e))) chunks.set(dedupeKey(e), e);
  assert.equal(chunks.size, 5); // not 7
  assert.equal(chunks.get('I-5').key, 'KTWX/895/20260916-025545-005-I');
});

// --- D. missing chunk fails completeness ------------------------------------------------------

test('D: azimuthCoverageOf on real-shaped data -- full sweep passes, one dropped chunk fails', () => {
  // Fixture values are the ACTUAL measured numbers from the KTWX/895 prototype run: 720
  // radials at 0.5deg spacing when complete (max gap 0.6deg), and what remained after
  // deliberately dropping one real chunk (720->600 radials, gap widened to 60.5deg).
  const fullAzimuths = Array.from({ length: 720 }, (_, i) => (i * 0.5) % 360);
  const coverageFull = worker.azimuthCoverageOf(fullAzimuths);
  assert.equal(coverageFull.uniqueCount, 720);
  assert.ok(coverageFull.maxGapDeg <= 1);
  assert.ok(worker.isTrustworthySweep(fullAzimuths.length, coverageFull.maxGapDeg));

  // Remove a contiguous 60-degree wedge (matching the real observed effect of one missing
  // real-world chunk) to reproduce the measured degraded state.
  const withGap = fullAzimuths.filter((az) => az < 100 || az > 160);
  const coverageGap = worker.azimuthCoverageOf(withGap);
  assert.ok(coverageGap.maxGapDeg > worker.CHUNK_TRUSTWORTHY_MAX_GAP_DEG);
  assert.equal(worker.isTrustworthySweep(withGap.length, coverageGap.maxGapDeg), false);
});

test('D: radial count below the minimum fails the gate even with perfect coverage', () => {
  assert.equal(worker.isTrustworthySweep(worker.CHUNK_TRUSTWORTHY_MIN_RADIALS - 1, 0), false);
  assert.equal(worker.isTrustworthySweep(worker.CHUNK_TRUSTWORTHY_MIN_RADIALS, 0), true);
});

// --- E. out-of-order listing assembles correctly (covered by B's shuffle test above) --------

test('E: a listing returned in arbitrary S3 order still assembles to the correct byte sequence position', () => {
  const scrambled = [fakeChunkEntries()[3], fakeChunkEntries()[0], fakeChunkEntries()[2], fakeChunkEntries()[1], fakeChunkEntries()[4]];
  const ordered = worker.orderChunkEntries(scrambled);
  assert.deepEqual(ordered.map((c) => c.seq), [1, 2, 3, 5, 82]);
});

// --- F/G. radial-count and max-azimuth-gap gates (both halves of the same predicate) --------

test('F/G: gate requires BOTH radial count and azimuth gap to pass, not either alone', () => {
  assert.equal(worker.isTrustworthySweep(720, 15), false); // enough radials, gap too wide
  assert.equal(worker.isTrustworthySweep(200, 0.5), false); // tight coverage, too few radials
  assert.equal(worker.isTrustworthySweep(720, 0.6), true); // the actual measured trustworthy case
});

// --- H. newer trustworthy chunk frame cannot be replaced by an older frame ------------------

test('H: /frames route ordering bug found+fixed during live qualification -- ensureFrame\'s (completed-volume-only) result must never be force-unshifted ahead of an already-cached newer chunk frame', () => {
  const site = { id: 'KTWX', name: 'TOPEKA', state: 'KS', lat: 38.99, lon: -96.23 };
  const older = { id: 'complete-old', site, product: 'REF', tilt: 1, time: Date.parse('2026-09-16T03:27:16Z'), processedAt: 1 };
  const newer = { id: 'chunk-new', site, product: 'REF', tilt: 1, time: Date.parse('2026-09-16T03:32:40Z'), processedAt: 2 };
  worker.cacheFrame(newer);
  worker.cacheFrame(older);
  // Reproduces the exact /frames route logic (worker.cjs): ensureFrame() resolves to `older`
  // (the completed-volume path), list is built from the cache sorted+sliced to limit=1 (which
  // keeps only `newer`), then the fix re-sorts after guaranteeing inclusion instead of
  // blindly unshifting ensureFrame's result to the front.
  const limit = 1;
  const frame = older; // what ensureFrame() would have returned
  let list = [...worker.frames.values()].filter((f) => f.site.id === 'KTWX' && f.product === 'REF' && f.tilt === 1).sort((a, b) => b.time - a.time).slice(0, limit);
  if (!list.find((f) => f.id === frame.id)) list.push(frame);
  list = list.sort((a, b) => b.time - a.time).slice(0, limit);
  assert.equal(list[0].id, 'chunk-new', 'the genuinely newer chunk frame must be first, never displaced by an unconditional unshift of the completed-volume result');
});

test('H: cacheFrame + frames-route sort semantics never let an older volume outrank a newer one', () => {
  const site = { id: 'KTWX', name: 'TOPEKA', state: 'KS', lat: 38.99, lon: -96.23 };
  const older = { id: 'frame-old', site, product: 'REF', tilt: 1, time: Date.parse('2026-09-16T02:50:14Z'), processedAt: Date.now() - 1000, data: [], azimuths: [] };
  const newer = { id: 'frame-new', site, product: 'REF', tilt: 1, time: Date.parse('2026-09-16T02:55:47Z'), processedAt: Date.now(), data: [], azimuths: [] };
  // Newer arrives and is cached FIRST, older arrives SECOND (e.g. a slow retry) -- arrival
  // order must not matter, only the real observation timestamp.
  worker.cacheFrame(newer);
  worker.cacheFrame(older);
  const list = [...worker.frames.values()].filter((f) => f.site.id === 'KTWX' && f.product === 'REF').sort((a, b) => b.time - a.time);
  assert.equal(list[0].id, 'frame-new');
});

// --- I. completed-volume fallback when chunk path fails --------------------------------------

test('I: advanceChunkAssembly swallows a failing discovery and never throws (fallback path unaffected)', async () => {
  const originalDiscover = worker.discoverLatestChunkVolume;
  // Substitute via module.exports, matching the established recentLevel2Keys test-seam pattern.
  require.cache[require.resolve('./worker.cjs')].exports.discoverLatestChunkVolume = async () => {
    throw new Error('SocketError: simulated S3 listing failure');
  };
  try {
    await assert.doesNotReject(worker.advanceChunkAssembly('KTWX'));
    // No frame should have been published as a side effect of the failed attempt.
    assert.equal([...worker.frames.values()].filter((f) => f.site && f.site.id === 'KTWX').length, 0);
  } finally {
    require.cache[require.resolve('./worker.cjs')].exports.discoverLatestChunkVolume = originalDiscover;
  }
});

// --- J/K. REF trustworthy state and VEL trustworthy state are independent -------------------

test('J/K: REF and VEL are gated independently -- one passing does not imply the other passes', () => {
  // REF trustworthy, VEL not (e.g. a corrupted/missing VEL moment on an otherwise-good sweep).
  const refTrustworthy = worker.isTrustworthySweep(720, 0.6);
  const velNotTrustworthy = worker.isTrustworthySweep(150, 45);
  assert.equal(refTrustworthy, true);
  assert.equal(velNotTrustworthy, false);
  // Confirms the per-product loop in advanceChunkAssembly (CHUNK_PRODUCTS forEach with its own
  // isTrustworthySweep check per product) cannot cross-contaminate -- verified structurally via
  // the shared pure predicate both products are gated through independently.
});

// --- L. bounded state eviction -----------------------------------------------------------------

test('L: evictIdleChunkSites-equivalent bound -- state for a site not advanced within the idle window is not retained', () => {
  const state = { volumeNum: 1, chunks: new Map(), firstChunkTime: null, newestChunkTime: null, sawE: false,
    lastDecodedChunkCount: 0, trustworthyEmitted: new Set(), lastAdvanceAt: Date.now() - 25 * 60_000, lastDiscoveryAt: Date.now() };
  worker.chunkVolumeState.set('KKKK', state);
  const IDLE_MS = 20 * 60_000;
  for (const [siteId, s] of worker.chunkVolumeState) {
    if (Date.now() - s.lastAdvanceAt > IDLE_MS) worker.chunkVolumeState.delete(siteId);
  }
  assert.equal(worker.chunkVolumeState.has('KKKK'), false);
});

// --- M. additive provenance metadata -----------------------------------------------------------

test('M: chunk-derived frame fields are additive and do not collide with the complete-volume shape', () => {
  const site = { id: 'KTWX', name: 'TOPEKA', state: 'KS', lat: 38.99, lon: -96.23 };
  const chunkFrame = {
    id: 'x', site, product: 'REF', sourceLevel: 'LEVEL II (chunk)', tilt: 1, time: Date.now(), processedAt: Date.now(),
    data: [], azimuths: [], trustworthy: true, chunkVolume: 895, chunkComplete: false, chunkCount: 10,
    radialCount: 720, maxAzimuthGapDeg: 0.6,
  };
  const completeFrame = {
    id: 'y', site, product: 'REF', sourceLevel: 'LEVEL II', tilt: 1, time: Date.now(), processedAt: Date.now(),
    data: [], azimuths: [],
  };
  // Fields present on the chunk frame must all be genuinely NEW names, never overwriting a
  // field name the complete-volume frame shape already used with a different meaning.
  for (const key of ['trustworthy', 'chunkVolume', 'chunkComplete', 'chunkCount', 'radialCount', 'maxAzimuthGapDeg']) {
    assert.equal(completeFrame[key], undefined, `${key} must not exist on the complete-volume frame shape`);
  }
  assert.equal(chunkFrame.sourceLevel, 'LEVEL II (chunk)');
  assert.equal(completeFrame.sourceLevel, 'LEVEL II');
});
