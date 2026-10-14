import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import ObsProducerPanel from "./ObsProducerPanel"
import { obsResolution, supportsObsAction, type ObsStatus } from "./obsProducerPolicy"
const status: ObsStatus = { engine: "obs", stateRevision: 2, formats: { program: { width: 1920, height: 1080, fps: 30 } }, source_state: "SOURCE_UNVERIFIED", obs: { currentScene: "NICK - LIVE CAMERA + STORM OVERLAY", fieldlineVisible: true }, recording: { writeToDisk: false }, audio: { inputMuted: false, inputVolumeDb: -12 }, capabilities: { actions: { scene: ["set"], audio: ["set"], overlay: ["visibility"], recording: ["start", "stop"], preview: ["start", "stop"], facebook: ["output.stop"] } } }
const render = (patch = {}) => renderToStaticMarkup(<ObsProducerPanel status={status} online allowed owner busy={false} message="" onLease={() => {}} onCommand={() => {}} {...patch} />)
describe("OBS Producer controls", () => {
  it("uses real OBS output dimensions and does not turn missing dimensions into 1080p", () => {
    expect(obsResolution(status)).toBe("1920 × 1080 · 30 fps")
    expect(obsResolution({ ...status, formats: {} })).toBe("Not reported")
    expect(obsResolution({ ...status, formats: { program: { width: NaN, height: 1080 } } })).toBe("Not reported")
  })
  it("requires the OBS engine and advertised action; output start is never supported", () => {
    expect(supportsObsAction(status, "obs.scene.set")).toBe(true)
    expect(supportsObsAction({ ...status, engine: "native" }, "obs.scene.set")).toBe(false)
    expect(supportsObsAction({ ...status, capabilities: {} }, "obs.scene.set")).toBe(false)
    expect(supportsObsAction(status, "facebook.output.start")).toBe(false)
  })
  it("renders honest sensor, audio, recording and output qualification labels", () => {
    const html = render()
    for (const label of ["OBS producer console", "1920 × 1080", "ESP → Core: unavailable", "not a clean camera archive", "Camera/audio freshness is not yet qualified", "Facebook Go Live — locked pending qualification", "Stop private monitor only"]) expect(html).toContain(label)
    expect(html).not.toContain("Show lower third")
    expect(html).not.toContain("Prepare non-public broadcast")
  })
  it("blocks edits without ownership or online status", () => {
    for (const patch of [{ owner: false }, { online: false }, { allowed: false }, { busy: true }]) expect(render(patch)).toContain('<fieldset disabled="">')
  })
  it("locks mutations after uncertainty while retaining emergency stops and explicit operator recovery", () => {
    const html = render({ uncertain: true, onResolveUncertainty: () => {} })
    expect(html).toContain('<fieldset disabled="">')
    expect(html).toMatch(/<button type="button" class="obs-producer__stop">STOP Facebook encoder/)
    expect(html).toContain("Verified in OBS — unlock edits")
  })
})
