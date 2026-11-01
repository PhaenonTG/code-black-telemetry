import { expect, it } from 'vitest';
import { estimateNorthernGulfLandfall } from '../../../hurricane/src/stormTelemetry';
import type { PublicHurricane } from '../../../hurricane/src/types';

const packet = (shift = 0) => ({status:'active',projection:{status:'ready',points:[]},official:{issued_at:'2026-10-09T12:00:00Z',track:[
  {hour:0,latitude:27,longitude:-87,valid_time:'2026-10-09T12:00:00Z'},
  {hour:12,latitude:29,longitude:-87,valid_time:new Date(Date.parse('2026-10-09T18:00:00Z')+shift).toISOString()},
  {hour:24,latitude:31,longitude:-87,valid_time:new Date(Date.parse('2026-10-10T00:00:00Z')+shift).toISOString()},
]}} as unknown as PublicHurricane);
it('uses absolute valid times despite nominal forecast-hour labels',()=>{
  const value=estimateNorthernGulfLandfall(packet(),'nhc')!;
  expect(value.windowStart).toBe('2026-10-09T18:00:00.000Z');
  expect(value.windowEnd).toBe('2026-10-10T00:00:00.000Z');
  expect(Date.parse(value.centerTime)).toBeLessThan(Date.parse(value.windowEnd));
});
it('recalculates the estimate as new projection timestamps arrive',()=>{
  const old=estimateNorthernGulfLandfall(packet(),'nhc')!;
  const next=estimateNorthernGulfLandfall(packet(3600000),'nhc')!;
  expect(Date.parse(next.centerTime)-Date.parse(old.centerTime)).toBe(3600000);
});
it('does not manufacture times for missing valid timestamps',()=>{
  const data=packet();data.official.track.forEach(p=>p.valid_time=null);
  expect(estimateNorthernGulfLandfall(data,'nhc')).toBeNull();
});
