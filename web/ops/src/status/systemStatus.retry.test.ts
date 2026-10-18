import { afterEach, describe, expect, it, vi } from "vitest"
import { retryOnceOnTransient } from "../core/client"
import { readOpsCoreConfig } from "../core/config"
import { buildSystemStatus, plainHealthDetail, probeSystemCore, retainHealth, systemTelemetry } from "./systemStatus"
vi.mock("../lib/supabase", () => ({ supabase: null }))
const config = readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: "/api/core" })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status})
describe("System Core reads", () => {
 it.each([502, 503, 504])("retries HTTP %s once before reporting a failure", async (status) => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response({runs:[{}]}))
  vi.stubGlobal("fetch", fetch)
  const result = probeSystemCore(config, "runs")
  await vi.advanceTimersByTimeAsync(250)
  expect(await result).toMatchObject({state:"LIVE", detail:expect.stringContaining("1 runs")})
  expect(fetch).toHaveBeenCalledTimes(2)
 })
 it("retries a timed-out read with a fresh signal and returns data", async () => {
  vi.useFakeTimers()
  const signals: AbortSignal[] = []
  vi.stubGlobal("fetch", vi.fn((_url, init) => {
   signals.push(init.signal)
   return signals.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(response({status:"active"}))
  }))
  const result = probeSystemCore(config, "hurricane-watch")
  await vi.advanceTimersByTimeAsync(8_250)
  expect(await result).toMatchObject({state:"LIVE"})
  expect(signals).toHaveLength(2)
  expect(signals[0].aborted).toBe(true)
  expect(signals[1]).not.toBe(signals[0])
 })
 it("stops after two gateway failures and keeps the last good value stale with its original timestamp", async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue(response({},502))
  vi.stubGlobal("fetch",fetch)
  const result = probeSystemCore(config,"runs")
  await vi.advanceTimersByTimeAsync(250)
  const failed = await result
  expect(failed).toEqual({state:"UNAVAILABLE", detail:"Service unavailable (HTTP 502)"})
  const good = retainHealth({state:"CHECKING",detail:"Checking"},{state:"LIVE",detail:"3 runs"},1_800_000_000_000)
  const stale = retainHealth(good,failed,1_800_000_060_000)
  expect(stale).toMatchObject({state:"STALE",asOf:good.asOf})
  expect(stale.detail).toContain("3 runs - as of ")
  expect(retainHealth(stale, failed, 1_800_000_120_000).asOf).toBe(good.asOf)
  expect(fetch).toHaveBeenCalledTimes(2)
 })
 it("bounds two hanging attempts to fifteen seconds", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch",vi.fn(()=>new Promise(()=>{})))
  const result = probeSystemCore(config,"runs")
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toEqual({state:"UNAVAILABLE", detail:"Timed out"})
  expect(vi.getTimerCount()).toBe(0)
 })
 it("does not retry other failures", async () => {
  const read = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
  await expect(retryOnceOnTransient(read)).rejects.toThrow("fetch failed")
  expect(read).toHaveBeenCalledTimes(1)
 })
 it("formats timeout, network and HTTP errors without browser exception text", () => {
  const abort = new DOMException("signal is aborted without reason","AbortError")
  expect(plainHealthDetail(abort,true)).toBe("Timed out, retrying")
  expect(plainHealthDetail(abort)).toBe("Timed out")
  expect(plainHealthDetail(new TypeError("fetch failed"))).toBe("Could not reach service")
  expect(plainHealthDetail(new Error("HTTP 502"))).toBe("Service unavailable (HTTP 502)")
 })
 it.each(["LIVE","CHECKING","STALE","DEGRADED","UNAVAILABLE","OFFLINE","DEVELOPMENT"] as const)("renders one Core row matching shared %s state", (state) => {
  const health = {state:"CHECKING" as const,detail:"Checking"}
  const rows = buildSystemStatus({core:{state,detail:"Shared Core health"},fabric:{state:"CHECKING",units:null},map:health,radar:health,singleSiteRadar:health,forecast:health,hurricane:health,weather:health,alerts:health})
  expect(rows.filter(row=>row.key==="core")).toEqual([{key:"core",label:"CORE",state,detail:"Shared Core health"}])
  expect(rows.find(row=>row.key==="telemetry")?.detail).toBe("Not monitored")
 })
})


describe("System status observations", () => {
 it("sanitizes raw external-probe errors on the rendered rows", () => {
  const health = {state:"UNAVAILABLE" as const,detail:"Radar unavailable - signal is aborted without reason"}
  const rows = buildSystemStatus({core:{state:"LIVE",detail:"Core API reachable"},fabric:{state:"CHECKING",units:null},map:health,radar:health,singleSiteRadar:health,forecast:health,hurricane:health,weather:health,alerts:health})
  expect(rows.find(row=>row.key==="radar")?.detail).toBe("Timed out")
  expect(rows.find(row=>row.key==="core")?.detail).toBe("Core API reachable")
 })
 it("uses quality-checked Fabric sensor samples for telemetry", () => {
  const now = Date.parse("2026-10-18T23:00:00Z")
  const unit = {unit_id:"striker",display_name:"STRIKER",operator_name:"Spencer",unit_type:"chase-platform",role:"chase-platform",capabilities:[],overall_health:"LIVE" as const,last_seen:now,devices:[{device_id:"weather",unit_id:"striker",device_type:"esp32-weather",display_label:"Weather",capabilities:[],connected:true,last_seen:now,metadata:{quality:{temperature_c:{state:"live",observed_at:now}}},latest:{mesonet:{temperature_c:20}}}]}
  expect(systemTelemetry([unit],"LIVE",now)).toMatchObject({state:"LIVE",asOf:now,detail:expect.stringContaining("1 verified sensor sample")})
  expect(systemTelemetry([unit],"UNAVAILABLE",now).state).toBe("STALE")
  expect(systemTelemetry([unit],"LIVE",now+60_000)).toEqual({state:"NOT_CONFIGURED",detail:"Not monitored"})
 })
})
