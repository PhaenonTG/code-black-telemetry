import { describe, it, expect, vi } from "vitest";
import { positionAt } from "../../../hurricane/src/forecastTime";
import { compassDirection } from "../../../hurricane/src/stormTelemetry";
import { fetchPointAlerts, DEFAULT_WATCH } from "../../../hurricane/src/watchLocation";

describe("Tropics time and alert contracts",()=>{
  it("aligns mixed model cycles by absolute valid time, without extrapolation",()=>{
    const points=[{latitude:26,longitude:-88,wind_mph:100,valid_time:"2026-10-09T12:00:00Z"},{latitude:28,longitude:-87,wind_mph:120,valid_time:"2026-10-10T00:00:00Z"}];
    expect(positionAt(points,Date.parse("2026-10-09T18:00:00Z"))).toMatchObject({latitude:27,longitude:-87.5,wind_mph:110});
    expect(positionAt(points,Date.parse("2026-10-10T06:00:00Z"))).toBeNull();
    expect(compassDirection(20)).toBe("NNE");
  });
  it("retains newest alert for the same event and area, preserving different areas",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({features:[
      {properties:{event:"Hurricane Warning",areaDesc:"Coastal",sent:"2026-10-09T10:00:00Z",headline:"Old"}},
      {properties:{event:"Hurricane Warning",areaDesc:"Coastal",sent:"2026-10-09T12:00:00Z",headline:"New"}},
      {properties:{event:"Hurricane Warning",areaDesc:"Inland",sent:"2026-10-09T11:00:00Z",headline:"Separate"}},
    ]})}));
    try {const rows=await fetchPointAlerts(DEFAULT_WATCH,new AbortController().signal);expect(rows.map(r=>r.headline)).toEqual(["New","Separate"]);}finally{vi.unstubAllGlobals();}
  });
});
