import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreOpsContext, type CoreOpsContextValue } from "../core/CoreOpsContext";
import SoundingsWorkspace from "./SoundingsWorkspace";

// Regression test for a real production bug: the workspace's request-lifecycle state defaulted
// to a fetch-in-flight-shaped value with no true "nothing requested yet" state available in
// OpsConnectionState, so both a fresh page load AND a location search that failed before ever
// calling loadSounding rendered "Loading sounding..." forever -- indistinguishable from a real
// hang. Reported live: searching Topeka, KS hit a real production 502 and the workspace never
// recovered from "Loading sounding...".
function contextValue(): CoreOpsContextValue {
  return {
    config: { mode: "LIVE_CORE", coreBaseUrl: "https://ops.codeblackwx.com/api/core", coreWsUrl: "wss://ops.codeblackwx.com/api/core", unitId: "cbwx-unit-tessa", stormIntelPollSeconds: 30 },
    state: {
      core: { state: "LIVE", detail: "", checkedAt: 0 },
      fabric: { state: "LIVE", detail: "", checkedAt: 0, health: null, units: null, wsState: "disabled", lastWsEventAt: null, lastContactAt: null, error: null },
      stormIntel: { state: "LIVE", detail: "", checkedAt: 0, health: null, selectedPoint: null, pointLoading: false, requestId: 0, pointSnapshot: null, pointError: null, pointHistory: [] },
      refreshedAt: 0,
    },
    selectedPoint: null,
    pointHistory: [],
    selectPoint: () => {},
    selectHistoryPoint: () => {},
  };
}

function renderWorkspace(): string {
  return renderToString(
    <CoreOpsContext.Provider value={contextValue()}>
      <SoundingsWorkspace />
    </CoreOpsContext.Provider>,
  );
}

describe("SoundingsWorkspace initial state", () => {
  it("never shows the loading state before any location has been requested", () => {
    const html = renderWorkspace();
    expect(html).not.toContain("Loading sounding");
  });

  it("shows the honest select-a-location prompt on first render", () => {
    const html = renderWorkspace();
    expect(html).toContain("Select a location to load a sounding.");
  });

  it("does not render a status pill before any request has been made", () => {
    const html = renderWorkspace();
    // OpsStatusPill always emits an ops-pill element; none should exist while idle.
    expect(html).not.toContain("ops-pill");
  });

  it("retains an empty search form (nothing fabricated) with no error shown yet", () => {
    const html = renderWorkspace();
    expect(html).not.toContain("soundings-panel__error");
  });
});
