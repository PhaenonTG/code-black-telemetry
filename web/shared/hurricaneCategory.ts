/** Current NHC Saffir–Simpson wind category; not a local-impact classification. */
export function hurricaneCategory(windMph: number | null | undefined, classification: string | null | undefined): number | null {
  if (classification !== "HU" || windMph == null || !Number.isFinite(windMph)) return null;
  if (windMph >= 157) return 5;
  if (windMph >= 130) return 4;
  if (windMph >= 111) return 3;
  if (windMph >= 96) return 2;
  if (windMph >= 74) return 1;
  return null;
}
