import { it, expect } from 'vitest';
import { sunsetUtc, daylightLeftMs } from './solar';
it.each([[35.4676, -97.5164, '2026-05-15', '2026-05-16T01:27Z'], [39.0473, -95.6752, '2026-06-21', '2026-06-22T01:52Z'], [36.45, -94.12, '2026-10-18', '2026-10-18T23:36Z']])('NOAA reference %s %s', (lat, lon, date, expected) => {
    const sunset = sunsetUtc(Number(lat), Number(lon), new Date(`${date}T18:00:00Z`));
    expect(sunset).not.toBeNull();
    expect(Math.abs(+sunset! - Date.parse(String(expected)))).toBeLessThanOrEqual(180000);
});
it('handles polar summer and daylight after sunset', () => { expect(sunsetUtc(80, 0, new Date('2026-06-21T18:00Z'))).toBeNull(); expect(daylightLeftMs(2000, new Date(1000))).toBe(0); expect(daylightLeftMs(0, null)).toBeNull(); });
