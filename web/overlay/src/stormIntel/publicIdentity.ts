/**
 * Internal fleet unit IDs (cbwx-unit-*) must never reach public-facing overlay text, per
 * `docs/system/code-black-fabric.md`'s "Public Overlay Boundary". This is the single choke point
 * that guarantees it -- callers must go through here rather than reading `unitId` directly.
 */
const INTERNAL_UNIT_ID_PATTERN = /^cbwx-unit-/i;

/**
 * Resolves what the overlay may show publicly for "who this is". Returns the configured human
 * identity when set; otherwise a generic fallback that is never the raw unit ID. Never returns
 * anything matching `cbwx-unit-*` even if a caller accidentally passes one in as `configured`.
 */
export function resolvePublicIdentity(configured: string | null, fallback = "CODE BLACK WX"): string {
  if (configured && !INTERNAL_UNIT_ID_PATTERN.test(configured.trim())) {
    return configured.trim();
  }
  return fallback;
}

export function isInternalUnitId(value: string): boolean {
  return INTERNAL_UNIT_ID_PATTERN.test(value.trim());
}
