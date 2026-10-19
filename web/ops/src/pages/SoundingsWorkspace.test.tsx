import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreOpsContext, type CoreOpsContextValue } from "../core/CoreOpsContext";
import { LocationControl } from "../layouts/LocationControl";
import SoundingsWorkspace from "./SoundingsWorkspace";

// Regression test for a real production bug: the workspace's request-lifecycle state defaulted
// to a fetch-in-flight-shaped value with no true "nothing requested yet" state available in
// OpsConnectionState, so both a fresh page load AND a location search that failed before ever
// calling loadSounding rendered "Loading sounding..." forever -- indistinguishable from a real
// hang. Reported live: searching Topeka, KS hit a real production 502 and the workspace never
// recovered from "Loading sounding...".
function contextValue(): CoreOpsContextValue {
  return {
    locationMode: "follow", updateDeviceLocation: () => {}, followDeviceLocation: () => {}, refreshPoint: () => {},
    deviceLocation: { status: "unavailable" }, referenceUnitId: "", referenceLabel: "Pea Ridge, AR · fallback", referenceIsFallback: true, referenceIsStale: false, referenceChaserFix: null, chooseChaserLocation: () => {}, chooseFallbackLocation: () => {},
    config: { mode: "LIVE_CORE", coreBaseUrl: "https://ops.codeblackwx.com/api/core", coreWsUrl: "wss://ops.codeblackwx.com/api/core", unitId: "cbwx-unit-tessa", stormIntelPollSeconds: 30 },
    state: {
      core: { state: "LIVE", detail: "", checkedAt: 0 },
      fabric: { state: "LIVE", detail: "", checkedAt: 0, health: null, units: null, streamState: "disabled", lastStreamEventAt: null, lastContactAt: null, error: null },
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
  it("gives the location form stable accessible names, without relying on placeholder text", () => {
    const html = renderWorkspace();
    expect(html).toContain('aria-label="Search sounding locations"');
    expect(html).toContain('aria-label="Sounding location city"');
    expect(html).toContain('aria-label="Sounding location state"');
  });

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

  it("renders one shared empty card, a Forecast header and a focusable profile region", () => {
    const html = renderWorkspace();
    expect(html.match(/async-view-state--empty/g)).toHaveLength(1);
    expect(html).toContain("FORECAST");
    expect(html).toContain("<h1>Soundings</h1>");
    expect(html).toContain('tabindex="0" role="region" aria-label="Sounding profile and parameters"');
  });
});


describe("LocationControl compact labels", () => {
  it.each([
    { mode: "follow", fallback: true, stale: false, label: "Pea Ridge, AR", expected: "Pea Ridge, AR", hint: "Fallback" },
    { mode: "fallback", fallback: true, stale: false, label: "Pea Ridge, AR", expected: "Pea Ridge, AR", hint: "Fixed reference" },
    { mode: "chaser", fallback: true, stale: true, label: "A very long chaser name awaiting GPS from the selected vehicle", expected: "A very long chaser name awaiting GPS from the selected vehicle", hint: "Last verified chaser position" },
    { mode: "manual", fallback: false, stale: false, label: "Selected point", expected: "36.450, -94.120", hint: "Selected point" },
  ] as const)("preserves the full $mode label and status inside truncatable elements", ({ mode, fallback, stale, label, expected, hint }) => {
    const value = contextValue();
    value.locationMode = mode;
    value.referenceIsFallback = fallback;
    value.referenceIsStale = stale;
    value.referenceLabel = label;
    value.selectedPoint = mode === "manual" ? { lat: 36.45, lon: -94.12 } : null;
    const html = renderToString(<CoreOpsContext.Provider value={value}><LocationControl /></CoreOpsContext.Provider>);
    expect(html).toContain('aria-label="OPS location reference"');
    expect(html).toContain(`<span class="location-control__name">${expected}</span><small>${hint}</small>`);
    expect(html).toContain('role="status"');
    expect(html).toContain('title="');
  });
});
