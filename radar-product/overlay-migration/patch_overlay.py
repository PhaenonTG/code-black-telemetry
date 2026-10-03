import re, sys
src = open("deployed-index.html", encoding="utf-8").read()
s = src

def sub(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"expected {count} match(es), found {n}: {old[:90]!r}"
    s = s.replace(old, new)

# ---- 1. Core radar product constants/state (after radarSettings) -----------------------------
sub("""    const radarSettings = { gatewayBase: params.get('radarGatewayBase') || 'https://ops.codeblackwx.com' };
""", """    const radarSettings = { gatewayBase: params.get('radarGatewayBase') || 'https://ops.codeblackwx.com' };
    // ---- Core radar product consumer (composite REF) ----
    // REF now comes from Core's standalone radar product: an atomically-published manifest plus
    // immutable timestamped frames (see the radar-product service). This page does NOT acquire
    // upstream radar, own acquisition timing, or decide source freshness -- the FRESH/AGING/STALE/
    // CRITICAL thresholds come from the manifest itself. Between manifest polls the age advances by
    // local elapsed time (monotonic clock) and is re-classified with the server's thresholds, so a
    // dead link degrades toward STALE/CRITICAL instead of freezing at "Live".
    const radarProductOrigin = (params.get('radarProductBase') || location.origin).replace(/\\/+$/, '');
    const CORE_RADAR_MANIFEST_URL = `${radarProductOrigin}/radar-product/v1/composite/latest.json`;
    const CORE_RADAR_POLL_MS = 20_000;
    let coreRadar = null; // { thresholds, fetchedPerfMs, serverAgeS, frames, ids }
    let coreRadarFetchInFlight = false;
    let coreRadarFailStreak = 0;
""")

# ---- 2. remove direct IEM upstream access from the overlay -----------------------------------
i0 = s.index("    // REF/VEL now render from IEM's RIDGE WMS")
i1 = s.index("    async function resolveMapboxToken()")
s = s[:i0] + "    // Radar acquisition is server-side only: this page never talks to an upstream radar provider.\n\n" + s[i1:]

i0 = s.index("        const iemProduct = IEM_PRODUCT_CODE[radarProduct];\n        const sector = iemSectorFor(radarSiteId);\n        const limit = radarProduct === 'REF' ? RADAR_FRAME_POOL_SIZE : 1;\n        const url = `${IEM_RIDGE_BASE}")
i1 = s.index("      } catch (err) {\n        // leave last-known frames in place -- a single missed poll isn't an outage\n      } finally {\n        radarFrameFetchInFlight = false;")
s = s[:i0] + s[i1:]

i0 = s.index("    // IEM single-archive WMS wants explicit UTC")
i1 = s.index("    const RADAR_PRELOAD_STAGGER_MS = 650;")
s = s[:i0] + s[i1:]

# ---- 3. fetchRadarFrames: REF -> core manifest -----------------------------------------------
sub("""    async function fetchRadarFrames() {
      if (!radarSiteId || radarFrameFetchInFlight) return;""", """    async function fetchRadarFrames() {
      if (radarProduct === 'REF') { applyCoreFramesFromCache(); return fetchCoreRadar(); }
      if (!radarSiteId || radarFrameFetchInFlight) return;""")

# ---- 4. preload: core frames, skip unchanged immutable URLs ----------------------------------
sub("""      const sector = iemSectorFor(radarSiteId);
      const iemProduct = IEM_PRODUCT_CODE[radarProduct];
      let assignedRealTile = false;
      for (let i = 0; i < RADAR_FRAME_POOL_SIZE; i++) {
        const frame = frames[i];
        let url = BLANK_TILE;
        if (frame && frame.kind === 'iem') {
          url = iemArchiveTileUrl(sector, iemProduct, frame.ts);
        } else if (frame && frame.kind === 'own') {
          url = `${radarSettings.gatewayBase}/api/v1/radar/tiles/${frame.frameId}/{z}/{x}/{y}.png`;
        }
        if (url === BLANK_TILE) { radarSourceHasRealTile.delete(i); } else { radarSourceHasRealTile.add(i); assignedRealTile = true; }
        window.setTimeout(() => {""", """      let assignedRealTile = false;
      for (let i = 0; i < RADAR_FRAME_POOL_SIZE; i++) {
        const frame = frames[i];
        let url = BLANK_TILE;
        if (frame && frame.kind === 'core') {
          url = frame.tileUrl;
        } else if (frame && frame.kind === 'own') {
          url = `${radarSettings.gatewayBase}/api/v1/radar/tiles/${frame.frameId}/{z}/{x}/{y}.png`;
        }
        if (url === BLANK_TILE) { radarSourceHasRealTile.delete(i); } else { radarSourceHasRealTile.add(i); }
        // Core frame URLs are immutable: re-assigning an unchanged URL would only force a needless
        // source reload, so slots whose URL did not change are left alone.
        const unchangedCore = frame && frame.kind === 'core' && radarSlotUrls[i] === url;
        radarSlotUrls[i] = url;
        if (unchangedCore) continue;
        if (url !== BLANK_TILE) assignedRealTile = true;
        window.setTimeout(() => {""")
sub("    const RADAR_PRELOAD_STAGGER_MS = 650;\n", "    const RADAR_PRELOAD_STAGGER_MS = 650;\n    const radarSlotUrls = [];\n")

# ---- 5. attribution on radar raster sources ---------------------------------------------------
sub("radarMap.addSource(radarSourceIds[i], { type: 'raster', tiles: [BLANK_TILE], tileSize: 256 });",
    "radarMap.addSource(radarSourceIds[i], { type: 'raster', tiles: [BLANK_TILE], tileSize: 256, attribution: 'Radar: NWS NEXRAD via Iowa Environmental Mesonet' });")

# ---- 6. health: CRITICAL state + core-driven classification ----------------------------------
sub("""      radarLoadingEl.classList.toggle('is-unavailable', next === 'UNAVAILABLE');
      if (next === 'LOADING') {""", """      radarLoadingEl.classList.toggle('is-unavailable', next === 'UNAVAILABLE' || next === 'CRITICAL');
      if (next === 'CRITICAL') {
        radarLoadingEl.textContent = 'Radar hidden - data critically old';
        radarLoadingEl.classList.remove('hidden');
      } else if (next === 'LOADING') {""")
sub("""      else if (next === 'UNAVAILABLE') radarLiveEl.classList.add('is-unavailable');
    }""", """      else if (next === 'UNAVAILABLE' || next === 'CRITICAL') radarLiveEl.classList.add('is-unavailable');
    }""")
sub("""    function updateRadarHealthState() {
      if (radarTileFailureStreak >= RADAR_TILE_FAILURE_THRESHOLD) {""", """    function updateRadarHealthState() {
      if (radarProduct === 'REF' && coreRadar === null && coreRadarFailStreak >= 3) {
        setRadarHealthState('UNAVAILABLE');
        return;
      }
      if (radarTileFailureStreak >= RADAR_TILE_FAILURE_THRESHOLD) {""")
sub("""      const newest = radarFrames[0];
      const ageMs = newest && newest.time ? Date.now() - new Date(newest.time).getTime() : null;
      if (ageMs === null || !Number.isFinite(ageMs)) { setRadarHealthState('LIVE'); return; }""", """      if (radarProduct === 'REF') {
        const coreState = coreRadarState();
        if (coreState === null) { setRadarHealthState('LOADING'); return; }
        setRadarHealthState(coreState === 'FRESH' ? 'LIVE' : coreState);
        return;
      }
      const newest = radarFrames[0];
      const ageMs = newest && newest.time ? Date.now() - new Date(newest.time).getTime() : null;
      if (ageMs === null || !Number.isFinite(ageMs)) { setRadarHealthState('LIVE'); return; }""")

# ---- 7. core helpers (before applyRadarFrame) -------------------------------------------------
sub("    function applyRadarFrame(index) {\n", """    function coreFrameAgeS(frame) {
      return frame.ageAtFetchS + (performance.now() - coreRadar.fetchedPerfMs) / 1000;
    }
    // FRESH/AGING/STALE/CRITICAL from the newest frame's server-reported age (advanced by local
    // elapsed time) using the thresholds published in the manifest -- never overlay-owned numbers.
    function coreRadarState() {
      if (!coreRadar || !coreRadar.frames.length) return null;
      const age = coreFrameAgeS(coreRadar.frames[0]);
      const t = coreRadar.thresholds;
      if (age <= t.fresh_max) return 'FRESH';
      if (age <= t.aging_max) return 'AGING';
      if (age <= t.stale_max) return 'STALE';
      return 'CRITICAL';
    }
    function applyCoreFramesFromCache() {
      if (!coreRadar) return;
      radarFrames = coreRadar.frames;
      preloadRadarFrames(radarFrames);
    }
    async function fetchCoreRadar() {
      if (coreRadarFetchInFlight) return;
      coreRadarFetchInFlight = true;
      try {
        const res = await fetchWithTimeout(CORE_RADAR_MANIFEST_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 8000);
        if (!res.ok) throw new Error('radar manifest fetch failed');
        const m = await res.json();
        if (!m || m.schema_version !== 1 || !Array.isArray(m.frames) || !m.frames.length || !m.freshness_thresholds_seconds) throw new Error('radar manifest invalid');
        const fetchedPerfMs = performance.now();
        const newestFirst = m.frames.slice(-RADAR_FRAME_POOL_SIZE).reverse().map(f => ({
          kind: 'core', frameId: f.frame_id, time: f.observation_time, ageAtFetchS: f.age_seconds,
          tileUrl: radarProductOrigin + f.assets.tile_template,
        }));
        const ids = newestFirst.map(f => f.frameId).join(',');
        const changed = !coreRadar || coreRadar.ids !== ids;
        coreRadar = { thresholds: m.freshness_thresholds_seconds, fetchedPerfMs, frames: newestFirst, ids };
        coreRadarFailStreak = 0;
        if (radarProduct === 'REF' && changed) {
          radarFrames = newestFirst;
          radarLoopIndex = 0;
          radarCloseLoopTick = 0;
          preloadRadarFrames(radarFrames);
        } else if (radarProduct === 'REF') {
          radarFrames = newestFirst; // refresh ages only; tile URLs are unchanged
        }
        updateRadarHealthState();
      } catch (err) {
        coreRadarFailStreak += 1;
        updateRadarHealthState();
      } finally {
        coreRadarFetchInFlight = false;
      }
    }

    function refreshRadarSiteLabel() {
      radarSiteText.textContent = radarProduct === 'REF' ? 'CONUS' : (radarSiteId || '----');
    }

    function applyRadarFrame(index) {
""")

# ---- 8. applyRadarFrame: opacity by state + core age text ------------------------------------
sub("""        if (radarMap.getLayer(id)) radarMap.setPaintProperty(id, 'raster-opacity', i === index ? 0.92 : 0);
      });
      // Part 9""", """        if (radarMap.getLayer(id)) radarMap.setPaintProperty(id, 'raster-opacity', i === index ? shownOpacity : 0);
      });
      // Part 9""")
sub("""    function applyRadarFrame(index) {
      if (!radarMapReady) return;
      radarLayerIds.forEach((id, i) => {""", """    function applyRadarFrame(index) {
      if (!radarMapReady) return;
      // CRITICAL suppresses radar entirely; STALE dims it (and the loop freezes on the newest frame)
      // so old imagery can never read as current.
      const shownOpacity = radarProduct === 'REF' && radarHealthState === 'CRITICAL' ? 0
        : radarProduct === 'REF' && radarHealthState === 'STALE' ? 0.55 : 0.92;
      radarLayerIds.forEach((id, i) => {""")
sub("""        const ageMs = Date.now() - new Date(shown.time).getTime();
        if (Number.isFinite(ageMs) && ageMs >= 0) {
          const mins = Math.floor(ageMs / 60000);
          radarScanAgeText.textContent = index === 0
            ? (mins < 1 ? 'Live' : `${mins}m ago`)
            : `${mins < 1 ? '<1' : mins}m ago (loop)`;
        }""", """        const isCore = shown.kind === 'core' && coreRadar;
        const ageMs = isCore ? coreFrameAgeS(shown) * 1000 : Date.now() - new Date(shown.time).getTime();
        if (Number.isFinite(ageMs) && ageMs >= 0) {
          const mins = Math.floor(ageMs / 60000);
          if (isCore && index === 0 && radarHealthState === 'CRITICAL') radarScanAgeText.textContent = `NO RADAR \\u00B7 ${mins}m old`;
          else if (isCore && index === 0 && radarHealthState === 'STALE') radarScanAgeText.textContent = `STALE \\u00B7 ${mins}m ago`;
          else if (isCore && index === 0 && radarHealthState === 'AGING') radarScanAgeText.textContent = `${mins}m ago \\u00B7 AGING`;
          else radarScanAgeText.textContent = index === 0
            ? (mins < 1 ? 'Live' : `${mins}m ago`)
            : `${mins < 1 ? '<1' : mins}m ago (loop)`;
        }""")

# ---- 9. loop freeze when stale/critical, labels, product switch -------------------------------
sub("""    function advanceRefLoop() {
      if (!radarFrames.length) return;""", """    function advanceRefLoop() {
      if (!radarFrames.length) return;
      if (radarProduct === 'REF' && (radarHealthState === 'STALE' || radarHealthState === 'CRITICAL')) {
        applyRadarFrame(0); // freeze on the newest frame; never loop old data as if it were live
        return;
      }""")
sub("        radarSiteText.textContent = radarSiteId;\n", "        refreshRadarSiteLabel();\n")
sub("      radarModeText.textContent = product;\n      radarFrames = [];", "      radarModeText.textContent = product;\n      refreshRadarSiteLabel();\n      radarFrames = [];")

# ---- 10. startup + polling ---------------------------------------------------------------------
sub("    setInterval(fetchRadarFrames, 120_000); // pick up new radar volume scans independent of site changes\n",
    "    setInterval(fetchRadarFrames, 120_000); // single-site (VEL/SRV/CC) frame refresh; REF polls the Core manifest below\n    refreshRadarSiteLabel();\n    fetchCoreRadar();\n    setInterval(fetchCoreRadar, CORE_RADAR_POLL_MS);\n")

# ---- state doc comment ---------------------------------------------------------------------------
sub("let radarHealthState = null; // null (not yet computed) | LOADING | LIVE | AGING | STALE | UNAVAILABLE",
    "let radarHealthState = null; // null (not yet computed) | LOADING | LIVE | AGING | STALE | CRITICAL | UNAVAILABLE")

assert "iastate" not in s.lower() and "IEM_RIDGE" not in s and "iemArchiveTileUrl" not in s and "IEM_PRODUCT_CODE" not in s and "iemSectorFor" not in s, "IEM residue remains"
open("new-index.html", "w", encoding="utf-8").write(s)
print("patched OK:", len(src), "->", len(s), "bytes")
