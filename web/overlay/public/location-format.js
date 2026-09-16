// Code Black WX -- shared location-label formatting (V1.3).
//
// Currently one function: resolving a US state/region label to its USPS 2-letter code
// without ever guessing from characters. Extracted into its own small shared script (same
// dual browser-global/CommonJS pattern as alert-priority-engine.js) so the "Topeka, KA" bug
// class -- a first-two-letters heuristic applied to a full state name -- has one fix location
// and a real regression test, instead of being reintroduced inline by some future edit.
(function (global) {
  'use strict';

  var US_STATE_NAME_TO_USPS = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
    kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
    michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
    nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
    ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
    'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
    vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
    wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
    'puerto rico': 'PR', guam: 'GU', 'american samoa': 'AS',
    'u.s. virgin islands': 'VI', 'virgin islands': 'VI',
    'northern mariana islands': 'MP',
  };

  // Prefers Nominatim's own ISO3166-2 code (e.g. "US-KS") when present -- more authoritative
  // than name-matching -- then the canonical name table above. Returns null (never a truncated
  // fragment) if neither resolves, so the caller can decide how to show an unmapped region.
  function usStateAbbreviation(stateName, iso3166_2) {
    if (iso3166_2 && /^US-[A-Z]{2}$/.test(iso3166_2)) return iso3166_2.slice(3);
    if (!stateName) return null;
    var trimmed = String(stateName).trim();
    if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase(); // already a valid-shaped code
    return US_STATE_NAME_TO_USPS[trimmed.toLowerCase()] || null;
  }

  var api = { usStateAbbreviation: usStateAbbreviation, US_STATE_NAME_TO_USPS: US_STATE_NAME_TO_USPS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodeBlackLocationFormat = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
