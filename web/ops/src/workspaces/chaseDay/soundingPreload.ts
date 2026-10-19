/** Only a finite point explicitly supplied by the operator can preload a full sounding. */
export function parseSoundingPreload(search: string): {
    lat: number;
    lon: number;
    label: string;
} | null {
    const query = new URLSearchParams(search), lat = query.get('lat'), lon = query.get('lon');
    if (!lat?.trim() || !lon?.trim())
        return null;
    const latitude = Number(lat), longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
        return null;
    return { lat: latitude, lon: longitude, label: query.get('label')?.trim().slice(0, 120) || 'Chase day target' };
}
