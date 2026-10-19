/** NOAA sunset approximation, zenith 90.833 degrees; date is the Chicago calendar date. */
export function sunsetUtc(lat: number, lon: number, date: Date): Date | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(+date))
        return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (key: string) => Number(parts.find(p => p.type === key)?.value);
    const y = part('year'), m = part('month'), d = part('day'), midnight = Date.UTC(y, m - 1, d);
    const n = Math.floor((midnight - Date.UTC(y, 0, 0)) / 86400000), rad = Math.PI / 180;
    const norm = (v: number) => ((v % 360) + 360) % 360;
    const t = n + (18 - lon / 15) / 24, mean = 0.9856 * t - 3.289;
    const l = norm(mean + 1.916 * Math.sin(mean * rad) + 0.020 * Math.sin(2 * mean * rad) + 282.634);
    let ra = norm(Math.atan(0.91764 * Math.tan(l * rad)) / rad);
    ra = (ra + Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90) / 15;
    const sinDec = 0.39782 * Math.sin(l * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1)
        return null;
    const utc = Math.acos(cosH) / rad / 15 + ra - 0.06571 * t - 6.622 - lon / 15;
    const hour = ((utc % 24) + 24) % 24;
    // Choose the UTC day corresponding to the target's evening (western longitudes often cross midnight).
    const dayOffset = Math.round((18 - lon / 15 - hour) / 24);
    return new Date(midnight + (hour + 24 * dayOffset) * 3600000);
}
export function daylightLeftMs(now: number, sunset: Date | null): number | null { return sunset ? Math.max(0, +sunset - now) : null; }
