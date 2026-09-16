// Code Black WX -- Location-Aware Single-Card Alert Priority Engine (V1.3).
//
// Pure, presentation-independent logic: given a chaser's trustworthy location and every
// currently-active alert/context candidate (warnings, watches, mesoscale discussions, SPC
// outlook), resolve the ONE thing the viewer should see right now. No DOM, no fetch, no
// classic-v2-specific coordinates/CSS/IDs -- a future, entirely different overlay can reuse
// this file unchanged. Loaded as a plain global-scope script (matches alert-feed.js's own
// convention in this codebase), not a module, so it works from a bare <script src> with no
// build step.
//
// Architectural flow this file owns: NORMALIZE -> CHECK LOCATION RELEVANCE -> RANK -> SELECT
// ONE. Callers are responsible for SOURCE DATA (fetching NWS/SPC/MD) and RENDER (drawing the
// SelectedAlertContext this returns) -- this file never touches either end.
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------------------
  // PART 4/5 -- Central, deliberately-ordered priority registry. One place to edit priority
  // or presentation role for a product type; nothing elsewhere in an overlay should hardcode
  // a priority number. Lower `priority` = shown first when multiple types are relevant
  // simultaneously (0 is highest-priority). presentationRole is a reusable visual treatment
  // key (Part 22) -- NOT a per-product ad-hoc style.
  //
  // Ordering rationale (deliberate, not API-array-order-dependent):
  //   Tornado Emergency > PDS/observed Tornado Warning > Tornado Warning >
  //   destructive/considerable Severe Thunderstorm Warning > Severe Thunderstorm Warning >
  //   Tornado Watch > Severe Thunderstorm Watch > Mesoscale Discussion > SPC categorical outlook.
  // This matches NWS/SPC's own operational severity ordering for these product classes.
  // ---------------------------------------------------------------------------------------
  // Extended to cover every class classic-v2's existing alertClassFor()/ALERT_SEVERITY_ORDER
  // already renders (flash flood, heat) so wiring this registry in as the selection layer
  // never silently drops a candidate class that was previously shown -- their relative order
  // here matches classic-v2's pre-existing ALERT_SEVERITY_ORDER exactly (no behavior change),
  // with mesoscaleDiscussion/spcOutlook (not NWS alert classes, no pre-existing order to match)
  // inserted after the watches per this task's own explicit priority spec.
  var ALERT_TYPES = {
    tornadoEmergency: { priority: 0, presentationRole: 'critical-red', label: 'Tornado Emergency' },
    tornadoWarningPds: { priority: 1, presentationRole: 'critical-red', label: 'PDS Tornado Warning' },
    tornadoWarningObserved: { priority: 1, presentationRole: 'critical-red', label: 'Tornado Warning (Observed)' },
    tornadoWarning: { priority: 2, presentationRole: 'critical-red', label: 'Tornado Warning' },
    severeThunderstormWarningDestructive: { priority: 3, presentationRole: 'severe-yellow-elevated', label: 'Destructive Severe Thunderstorm Warning' },
    severeThunderstormWarningConsiderable: { priority: 4, presentationRole: 'severe-yellow-elevated', label: 'Considerable Severe Thunderstorm Warning' },
    severeThunderstormWarning: { priority: 5, presentationRole: 'severe-yellow', label: 'Severe Thunderstorm Warning' },
    flashFloodWarning: { priority: 6, presentationRole: 'severe-green', label: 'Flash Flood Warning' },
    heatWarning: { priority: 7, presentationRole: 'heat', label: 'Excessive Heat Warning' },
    tornadoWatchPds: { priority: 8, presentationRole: 'watch-elevated', label: 'PDS Tornado Watch' },
    tornadoWatch: { priority: 9, presentationRole: 'watch', label: 'Tornado Watch' },
    severeThunderstormWatch: { priority: 10, presentationRole: 'watch', label: 'Severe Thunderstorm Watch' },
    flashFloodWatch: { priority: 11, presentationRole: 'watch', label: 'Flash Flood Watch' },
    heatAdvisory: { priority: 12, presentationRole: 'advisory', label: 'Heat Advisory' },
    mesoscaleDiscussion: { priority: 13, presentationRole: 'discussion', label: 'Mesoscale Discussion' },
    spcOutlook: { priority: 14, presentationRole: 'outlook', label: 'SPC Outlook' },
    generic: { priority: 15, presentationRole: 'generic', label: 'Active Weather Alert' },
  };

  // Authoritative MODIFIERS are kept separate from product TYPE (Part 4) -- a modifier only
  // ever selects a MORE SPECIFIC entry in ALERT_TYPES above (e.g. "PDS" + tornadoWarning ->
  // tornadoWarningPds); it never invents a new severity level on its own, and a modifier this
  // engine doesn't recognize is simply ignored (falls back to the base type), never guessed at.
  var MODIFIER_TYPE_OVERRIDE = {
    tornadoWarning: { pds: 'tornadoWarningPds', observed: 'tornadoWarningObserved' },
    severeThunderstormWarning: { destructive: 'severeThunderstormWarningDestructive', considerable: 'severeThunderstormWarningConsiderable' },
    tornadoWatch: { pds: 'tornadoWatchPds' },
  };

  function resolveType(baseType, modifiers) {
    if (!modifiers || !modifiers.length) return baseType;
    var overrides = MODIFIER_TYPE_OVERRIDE[baseType];
    if (!overrides) return baseType;
    for (var i = 0; i < modifiers.length; i++) {
      var resolved = overrides[modifiers[i]];
      if (resolved && ALERT_TYPES[resolved]) return resolved;
    }
    return baseType;
  }

  // ---------------------------------------------------------------------------------------
  // PART 1/10 -- Point-in-polygon. Ray-casting (even-odd rule), supporting Polygon,
  // MultiPolygon, AND holes (a ring after the first is subtracted, per GeoJSON convention --
  // the classic-v2 SPC-only version this was generalized from checked ring 0 only). This is
  // the ONE authoritative relevance check every candidate with real geometry goes through --
  // never county-name string matching when geometry exists (Part 10).
  // ---------------------------------------------------------------------------------------
  function pointInRing(point, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = (yi > point.lat) !== (yj > point.lat) &&
        point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonWithHoles(point, rings) {
    if (!rings || !rings.length) return false;
    if (!pointInRing(point, rings[0])) return false;
    for (var i = 1; i < rings.length; i++) {
      if (pointInRing(point, rings[i])) return false; // inside a hole -- not actually covered
    }
    return true;
  }

  function pointInGeometry(point, geometry) {
    if (!geometry || !point || typeof point.lat !== 'number' || typeof point.lon !== 'number') return false;
    if (geometry.type === 'Polygon') return pointInPolygonWithHoles(point, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') {
      for (var i = 0; i < geometry.coordinates.length; i++) {
        if (pointInPolygonWithHoles(point, geometry.coordinates[i])) return true;
      }
      return false;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------
  // PART 2 -- Location freshness policy, thresholds match the freshness semantics already
  // established elsewhere in Code Black (see docs/system/code-black-fabric.md's presence
  // thresholds -- this engine reuses the same LIVE/DEGRADED/STALE spirit rather than
  // inventing a fourth scheme): fresh <= 15s, aging <= 60s, stale <= 300s, unavailable beyond
  // that or with no timestamp at all.
  //
  // Policy (documented, not implicit):
  //   - fresh or aging location: authoritative for geometry-based relevance checks.
  //   - stale location: an ALREADY-selected candidate may remain visible if its own
  //     authoritative expiresAt has not passed (avoids flicker-to-baseline on a brief GPS
  //     gap) -- but a NEW geometry-based promotion is never made from a stale point (this
  //     engine will not claim the chaser entered a warning it can no longer confirm).
  //   - unavailable location: no geometry-based candidate can be selected or retained;
  //     resolves to the best non-geometry candidate (SPC outlook needs a point too, so in
  //     practice this means "no context", which callers render as their own baseline/idle
  //     state -- this engine never fabricates a location).
  // ---------------------------------------------------------------------------------------
  var LOCATION_FRESH_MS = 15 * 1000;
  var LOCATION_AGING_MS = 60 * 1000;
  var LOCATION_STALE_MS = 300 * 1000;

  function classifyLocationFreshness(location, now) {
    if (!location || typeof location.lat !== 'number' || typeof location.lon !== 'number' || typeof location.observedAt !== 'number') {
      return 'unavailable';
    }
    var age = now - location.observedAt;
    if (age < 0 || !Number.isFinite(age)) return 'unavailable';
    if (age <= LOCATION_FRESH_MS) return 'fresh';
    if (age <= LOCATION_AGING_MS) return 'aging';
    if (age <= LOCATION_STALE_MS) return 'stale';
    return 'unavailable';
  }

  // ---------------------------------------------------------------------------------------
  // PART 3 -- Normalized candidate contract. Callers build these from whatever raw shape
  // their source API returns (NWS CAP JSON, SPC outlook GeoJSON, a future MD feed) -- this
  // engine never parses raw NWS/SPC JSON itself (Part 3's explicit boundary).
  //
  // AlertCandidate {
  //   id: string                 stable, unique per real-world product (e.g. NWS alert id,
  //                               or `spc-outlook-day1-<label>`) -- used as the final,
  //                               deterministic tie-break (Part 6).
  //   type: string                a key into ALERT_TYPES (post-modifier-resolution is done
  //                               internally by resolveSelectedContext; callers may pass the
  //                               base type + modifiers, or an already-resolved type).
  //   source: string               'nws-alert' | 'spc-outlook' | 'spc-md' | ... (provenance only)
  //   title: string
  //   subtitle: string | null
  //   issuedAt: number | null (epoch ms)
  //   effectiveAt: number | null
  //   expiresAt: number | null    null means "does not expire on its own" (e.g. SPC outlook,
  //                               which is superseded by a new issuance, not a timer)
  //   geometry: GeoJSON geometry | null   null means "relevanceMode must not be 'geometry'"
  //   relevanceMode: 'geometry' | 'always'   'always' is for the SPC-outlook-style baseline
  //                               candidate that has no per-point geometry check beyond what
  //                               the caller already resolved (spcHighestRisk-style callers
  //                               still do their own point-in-polygon before constructing the
  //                               candidate; SPC categorical risk IS geometry-relevant, callers
  //                               should prefer 'geometry' whenever they have the raw geometry
  //                               to hand instead).
  //   modifiers: string[]          e.g. ['pds'], ['observed'], ['destructive']
  //   cancelled: boolean            explicit cancellation, distinct from natural expiration
  //   metadata: object              anything else a presentation layer wants (raw feature, etc.)
  // }
  // ---------------------------------------------------------------------------------------

  function isCandidateActive(candidate, now) {
    if (candidate.cancelled) return false;
    if (typeof candidate.expiresAt === 'number' && candidate.expiresAt <= now) return false;
    return true;
  }

  // Part 1/2: does this ONE candidate actually apply to this chaser right now.
  function isCandidateRelevant(candidate, location, locationFreshness) {
    if (candidate.relevanceMode === 'always') return true;
    if (candidate.relevanceMode !== 'geometry') return false;
    if (!candidate.geometry) return false;
    // A stale/unavailable location can never justify a NEW geometry-based relevance claim.
    if (locationFreshness === 'stale' || locationFreshness === 'unavailable') return false;
    return pointInGeometry(location, candidate.geometry);
  }

  // Part 6: deterministic tie-break, applied only when primary `priority` ties.
  //   1. stronger authoritative threat modifier (more modifiers = more specific/severe)
  //   2. more specific applicable product (already folded into `priority` via
  //      resolveType/ALERT_TYPES -- ties here mean truly identical type)
  //   3. newer effective/issued time
  //   4. stable id, lexical -- final, always-deterministic fallback
  function compareCandidates(a, b) {
    var pa = ALERT_TYPES[a.resolvedType].priority;
    var pb = ALERT_TYPES[b.resolvedType].priority;
    if (pa !== pb) return pa - pb;
    var ma = (a.modifiers || []).length;
    var mb = (b.modifiers || []).length;
    if (ma !== mb) return mb - ma; // more modifiers first
    var ta = a.effectiveAt || a.issuedAt || 0;
    var tb = b.effectiveAt || b.issuedAt || 0;
    if (ta !== tb) return tb - ta; // newer first
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  // ---------------------------------------------------------------------------------------
  // PART 7/8/11/13/14 -- The one public entry point. Pure function: same inputs always
  // produce the same SelectedAlertContext (Part 6's determinism requirement, verified by
  // feeding the same candidates in reversed order in tests).
  //
  // `previousSelectedId` (optional) is used only for Part 8's demotion/fallback framing in
  // documentation/tests -- the function itself is stateless per call; callers who want
  // "promotion/demotion" behavior over time simply call this again on every poll/tick with
  // the current candidate list, and the result naturally moves up/down as candidates
  // change relevance -- there is no separate "promote" or "demote" code path to keep in
  // sync, which is what makes Part 8 automatic rather than a second thing to implement.
  //
  // Part 14 (source outage): this function never knows or cares WHY a candidate is/isn't in
  // the list -- that decision (e.g. "the NWS fetch failed, so keep feeding the previous
  // candidate list rather than an empty one, but only until any of those candidates'
  // expiresAt passes") belongs to the caller's polling loop, documented in
  // classic-v2.html's own integration comment, not duplicated here.
  // ---------------------------------------------------------------------------------------
  function resolveSelectedContext(candidates, location, now) {
    now = typeof now === 'number' ? now : Date.now();
    var freshness = classifyLocationFreshness(location, now);
    var relevant = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!isCandidateActive(c, now)) continue;
      var resolvedType = resolveType(c.type, c.modifiers);
      if (!ALERT_TYPES[resolvedType]) continue; // unknown type -- never select the unrecognized
      if (!isCandidateRelevant(c, location, freshness)) continue;
      relevant.push(Object.assign({}, c, { resolvedType: resolvedType }));
    }
    if (!relevant.length) {
      return { selected: null, locationFreshness: freshness, candidateCount: candidates.length, relevantCount: 0 };
    }
    relevant.sort(compareCandidates);
    var winner = relevant[0];
    var typeInfo = ALERT_TYPES[winner.resolvedType];
    var selected = {
      id: winner.id,
      type: winner.resolvedType,
      priority: typeInfo.priority,
      title: winner.title || typeInfo.label,
      subtitle: winner.subtitle || null,
      expiresAt: typeof winner.expiresAt === 'number' ? winner.expiresAt : null,
      presentationRole: typeInfo.presentationRole,
      source: winner.source,
      modifiers: winner.modifiers || [],
    };
    return { selected: selected, locationFreshness: freshness, candidateCount: candidates.length, relevantCount: relevant.length };
  }

  var api = {
    ALERT_TYPES: ALERT_TYPES,
    resolveType: resolveType,
    pointInGeometry: pointInGeometry,
    classifyLocationFreshness: classifyLocationFreshness,
    isCandidateActive: isCandidateActive,
    isCandidateRelevant: isCandidateRelevant,
    compareCandidates: compareCandidates,
    resolveSelectedContext: resolveSelectedContext,
    LOCATION_FRESH_MS: LOCATION_FRESH_MS,
    LOCATION_AGING_MS: LOCATION_AGING_MS,
    LOCATION_STALE_MS: LOCATION_STALE_MS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodeBlackAlertPriorityEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
