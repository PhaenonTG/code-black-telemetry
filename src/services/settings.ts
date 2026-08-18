import { Preferences } from "@capacitor/preferences";

const PI_ENDPOINT_KEY = "codeblack.piEndpoint";
const DEFAULT_PI_ENDPOINT = "";

let currentPiEndpoint = DEFAULT_PI_ENDPOINT;
const listeners = new Set<(endpoint: string) => void>();

const CHASER_RADIUS_KEY = "codeblack.chaserRadiusMiles";
export const DEFAULT_CHASER_RADIUS_MILES = 25;
const MIN_CHASER_RADIUS_MILES = 5;
const MAX_CHASER_RADIUS_MILES = 500;

let currentChaserRadiusMiles = DEFAULT_CHASER_RADIUS_MILES;
const chaserRadiusListeners = new Set<(radiusMiles: number) => void>();

const REPORT_FEED_RADIUS_KEY = "codeblack.reportFeedRadiusMiles";
const REPORT_FEED_RETENTION_KEY = "codeblack.reportFeedRetentionHours";
export const DEFAULT_REPORT_FEED_RADIUS_MILES = 50;
export const DEFAULT_REPORT_FEED_RETENTION_HOURS = 3;
const MIN_REPORT_FEED_RADIUS_MILES = 5;
const MAX_REPORT_FEED_RADIUS_MILES = 500;
const MIN_REPORT_FEED_RETENTION_HOURS = 1;
const MAX_REPORT_FEED_RETENTION_HOURS = 24;

let currentReportFeedRadiusMiles = DEFAULT_REPORT_FEED_RADIUS_MILES;
let currentReportFeedRetentionHours = DEFAULT_REPORT_FEED_RETENTION_HOURS;
const reportFeedRadiusListeners = new Set<(radiusMiles: number) => void>();
const reportFeedRetentionListeners = new Set<(hours: number) => void>();

function clampChaserRadius(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CHASER_RADIUS_MILES;
  return Math.min(MAX_CHASER_RADIUS_MILES, Math.max(MIN_CHASER_RADIUS_MILES, Math.round(value)));
}

export async function loadChaserRadiusMiles() {
  const saved = await Preferences.get({ key: CHASER_RADIUS_KEY });
  currentChaserRadiusMiles = saved.value ? clampChaserRadius(Number(saved.value)) : DEFAULT_CHASER_RADIUS_MILES;
  chaserRadiusListeners.forEach((listener) => listener(currentChaserRadiusMiles));
  return currentChaserRadiusMiles;
}

export async function saveChaserRadiusMiles(value: number) {
  currentChaserRadiusMiles = clampChaserRadius(value);
  await Preferences.set({ key: CHASER_RADIUS_KEY, value: String(currentChaserRadiusMiles) });
  chaserRadiusListeners.forEach((listener) => listener(currentChaserRadiusMiles));
  return currentChaserRadiusMiles;
}

export function getChaserRadiusMiles() {
  return currentChaserRadiusMiles;
}

export function subscribeChaserRadiusMiles(listener: (radiusMiles: number) => void) {
  chaserRadiusListeners.add(listener);
  listener(currentChaserRadiusMiles);
  return () => chaserRadiusListeners.delete(listener);
}

function clampReportFeedRadius(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_REPORT_FEED_RADIUS_MILES;
  return Math.min(MAX_REPORT_FEED_RADIUS_MILES, Math.max(MIN_REPORT_FEED_RADIUS_MILES, Math.round(value)));
}

function clampReportFeedRetention(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_REPORT_FEED_RETENTION_HOURS;
  return Math.min(MAX_REPORT_FEED_RETENTION_HOURS, Math.max(MIN_REPORT_FEED_RETENTION_HOURS, Math.round(value)));
}

export async function loadReportFeedRadiusMiles() {
  const saved = await Preferences.get({ key: REPORT_FEED_RADIUS_KEY });
  currentReportFeedRadiusMiles = saved.value ? clampReportFeedRadius(Number(saved.value)) : DEFAULT_REPORT_FEED_RADIUS_MILES;
  reportFeedRadiusListeners.forEach((listener) => listener(currentReportFeedRadiusMiles));
  return currentReportFeedRadiusMiles;
}

export async function saveReportFeedRadiusMiles(value: number) {
  currentReportFeedRadiusMiles = clampReportFeedRadius(value);
  await Preferences.set({ key: REPORT_FEED_RADIUS_KEY, value: String(currentReportFeedRadiusMiles) });
  reportFeedRadiusListeners.forEach((listener) => listener(currentReportFeedRadiusMiles));
  return currentReportFeedRadiusMiles;
}

export function subscribeReportFeedRadiusMiles(listener: (radiusMiles: number) => void) {
  reportFeedRadiusListeners.add(listener);
  listener(currentReportFeedRadiusMiles);
  return () => reportFeedRadiusListeners.delete(listener);
}

export async function loadReportFeedRetentionHours() {
  const saved = await Preferences.get({ key: REPORT_FEED_RETENTION_KEY });
  currentReportFeedRetentionHours = saved.value ? clampReportFeedRetention(Number(saved.value)) : DEFAULT_REPORT_FEED_RETENTION_HOURS;
  reportFeedRetentionListeners.forEach((listener) => listener(currentReportFeedRetentionHours));
  return currentReportFeedRetentionHours;
}

export async function saveReportFeedRetentionHours(value: number) {
  currentReportFeedRetentionHours = clampReportFeedRetention(value);
  await Preferences.set({ key: REPORT_FEED_RETENTION_KEY, value: String(currentReportFeedRetentionHours) });
  reportFeedRetentionListeners.forEach((listener) => listener(currentReportFeedRetentionHours));
  return currentReportFeedRetentionHours;
}

export function subscribeReportFeedRetentionHours(listener: (hours: number) => void) {
  reportFeedRetentionListeners.add(listener);
  listener(currentReportFeedRetentionHours);
  return () => reportFeedRetentionListeners.delete(listener);
}

export type PinShape = "circle" | "diamond" | "triangle" | "star" | "square";

export interface PinStyle {
  color: string;
  shape: PinShape;
  // Multiplier on the normal zoom-based pin size (see pinSizeForZoom in AtlasPinMarkers.ts).
  // Defaults to 1 -- missing on anything saved before this field existed.
  sizeScale: number;
}

export const MIN_PIN_SIZE_SCALE = 0.5;
export const MAX_PIN_SIZE_SCALE = 2.5;

export function clampPinSizeScale(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_PIN_SIZE_SCALE, Math.max(MIN_PIN_SIZE_SCALE, value));
}

const TEAM_MEMBERS_KEY = "codeblack.teamMembers";
const TEAM_PIN_STYLE_KEY = "codeblack.teamPinStyle";
const CHASER_PIN_STYLE_KEY = "codeblack.chaserPinStyle";
// Green is unclaimed anywhere else in this app's palette and conventionally reads as
// "friendly/team" on a tactical map -- distinct from red (warnings + your own vehicle) and amber
// (watches). Chasers default to a muted, informational white/grey. Both are just starting points;
// full override lives in Settings.
const DEFAULT_TEAM_PIN_STYLE: PinStyle = { color: "#3ddc70", shape: "diamond", sizeScale: 1 };
const DEFAULT_CHASER_PIN_STYLE: PinStyle = { color: "#c7ccd6", shape: "circle", sizeScale: 1 };

export interface TeamMember {
  id: string;
  name: string;
  group: string;
  phone: string;
  email: string;
}

// Was a flat string[] of names/marker IDs -- the owner asked for real teams/groups with per-member
// contact info, a step up from "just a roster that filters the map." `group` is a free-text label
// (e.g. "Alpha", "Chase Vehicle 2") rather than a separate managed entity -- multiple members can
// share a group name, and there's no fixed group list to maintain elsewhere. `name` is still what
// resolveTeamPositions() (teamPositions.ts) matches against the live Spotter Network feed to place
// a pin; phone/email are purely for the contact-info popup, not used for matching.
let currentTeamMembers: TeamMember[] = [];
const teamMembersListeners = new Set<(members: TeamMember[]) => void>();
let currentTeamPinStyle: PinStyle = DEFAULT_TEAM_PIN_STYLE;
const teamPinStyleListeners = new Set<(style: PinStyle) => void>();
let currentChaserPinStyle: PinStyle = DEFAULT_CHASER_PIN_STYLE;
const chaserPinStyleListeners = new Set<(style: PinStyle) => void>();

export async function loadTeamMembers() {
  const saved = await Preferences.get({ key: TEAM_MEMBERS_KEY });
  try {
    currentTeamMembers = saved.value ? (JSON.parse(saved.value) as TeamMember[]) : [];
  } catch {
    currentTeamMembers = [];
  }
  teamMembersListeners.forEach((listener) => listener(currentTeamMembers));
  return currentTeamMembers;
}

export async function saveTeamMembers(members: TeamMember[]) {
  currentTeamMembers = members;
  await Preferences.set({ key: TEAM_MEMBERS_KEY, value: JSON.stringify(currentTeamMembers) });
  teamMembersListeners.forEach((listener) => listener(currentTeamMembers));
  return currentTeamMembers;
}

export function getTeamMembers() {
  return currentTeamMembers;
}

export function subscribeTeamMembers(listener: (members: TeamMember[]) => void) {
  teamMembersListeners.add(listener);
  listener(currentTeamMembers);
  return () => {
    teamMembersListeners.delete(listener);
  };
}

function loadPinStyleFactory(key: string, fallback: PinStyle, currentSetter: (style: PinStyle) => void, listeners: Set<(style: PinStyle) => void>) {
  return async () => {
    const saved = await Preferences.get({ key });
    let next = fallback;
    if (saved.value) {
      try {
        const parsed = JSON.parse(saved.value) as Partial<PinStyle>;
        if (parsed.color && parsed.shape) next = { color: parsed.color, shape: parsed.shape, sizeScale: clampPinSizeScale(parsed.sizeScale ?? 1) };
      } catch {
        next = fallback;
      }
    }
    currentSetter(next);
    listeners.forEach((listener) => listener(next));
    return next;
  };
}

export const loadTeamPinStyle = loadPinStyleFactory(TEAM_PIN_STYLE_KEY, DEFAULT_TEAM_PIN_STYLE, (style) => { currentTeamPinStyle = style; }, teamPinStyleListeners);
export const loadChaserPinStyle = loadPinStyleFactory(CHASER_PIN_STYLE_KEY, DEFAULT_CHASER_PIN_STYLE, (style) => { currentChaserPinStyle = style; }, chaserPinStyleListeners);

export async function saveTeamPinStyle(style: PinStyle) {
  currentTeamPinStyle = style;
  await Preferences.set({ key: TEAM_PIN_STYLE_KEY, value: JSON.stringify(style) });
  teamPinStyleListeners.forEach((listener) => listener(style));
  return style;
}

export async function saveChaserPinStyle(style: PinStyle) {
  currentChaserPinStyle = style;
  await Preferences.set({ key: CHASER_PIN_STYLE_KEY, value: JSON.stringify(style) });
  chaserPinStyleListeners.forEach((listener) => listener(style));
  return style;
}

export function getTeamPinStyle() {
  return currentTeamPinStyle;
}

export function getChaserPinStyle() {
  return currentChaserPinStyle;
}

export function subscribeTeamPinStyle(listener: (style: PinStyle) => void) {
  teamPinStyleListeners.add(listener);
  listener(currentTeamPinStyle);
  return () => {
    teamPinStyleListeners.delete(listener);
  };
}

export function subscribeChaserPinStyle(listener: (style: PinStyle) => void) {
  chaserPinStyleListeners.add(listener);
  listener(currentChaserPinStyle);
  return () => {
    chaserPinStyleListeners.delete(listener);
  };
}

export type VehicleMarkerShape = PinShape;

export interface VehicleMarkerStyle {
  color: string;
  shape: VehicleMarkerShape;
  sizeScale: number;
}

const VEHICLE_MARKER_STYLE_KEY = "codeblack.vehicleMarkerStyle";
const DEFAULT_VEHICLE_MARKER_STYLE: VehicleMarkerStyle = { color: "#ff2d35", shape: "circle", sizeScale: 1 };

let currentVehicleMarkerStyle: VehicleMarkerStyle = DEFAULT_VEHICLE_MARKER_STYLE;
const vehicleMarkerStyleListeners = new Set<(style: VehicleMarkerStyle) => void>();

export async function loadVehicleMarkerStyle() {
  const saved = await Preferences.get({ key: VEHICLE_MARKER_STYLE_KEY });
  let next = DEFAULT_VEHICLE_MARKER_STYLE;
  if (saved.value) {
    try {
      const parsed = JSON.parse(saved.value) as Omit<Partial<VehicleMarkerStyle>, "shape"> & { shape?: string };
      // "custom" (uploaded-image marker) was removed -- fall back to circle for anyone who'd set it.
      const shape = parsed.shape && parsed.shape !== "custom" ? (parsed.shape as PinShape) : "circle";
      if (parsed.color) next = { color: parsed.color, shape, sizeScale: clampPinSizeScale(parsed.sizeScale ?? 1) };
    } catch {
      next = DEFAULT_VEHICLE_MARKER_STYLE;
    }
  }
  currentVehicleMarkerStyle = next;
  vehicleMarkerStyleListeners.forEach((listener) => listener(next));
  return next;
}

export async function saveVehicleMarkerStyle(style: VehicleMarkerStyle) {
  currentVehicleMarkerStyle = style;
  await Preferences.set({ key: VEHICLE_MARKER_STYLE_KEY, value: JSON.stringify(style) });
  vehicleMarkerStyleListeners.forEach((listener) => listener(style));
  return style;
}

export function getVehicleMarkerStyle() {
  return currentVehicleMarkerStyle;
}

export function subscribeVehicleMarkerStyle(listener: (style: VehicleMarkerStyle) => void) {
  vehicleMarkerStyleListeners.add(listener);
  listener(currentVehicleMarkerStyle);
  return () => {
    vehicleMarkerStyleListeners.delete(listener);
  };
}

const BLE_COMMAND_TOKEN_KEY = "codeblack.bleCommandToken";
let currentBleCommandToken = "";
const bleCommandTokenListeners = new Set<(token: string) => void>();

export async function loadBleCommandToken() {
  const saved = await Preferences.get({ key: BLE_COMMAND_TOKEN_KEY });
  currentBleCommandToken = saved.value ?? "";
  bleCommandTokenListeners.forEach((listener) => listener(currentBleCommandToken));
  return currentBleCommandToken;
}

export async function saveBleCommandToken(value: string) {
  currentBleCommandToken = value.trim();
  await Preferences.set({ key: BLE_COMMAND_TOKEN_KEY, value: currentBleCommandToken });
  bleCommandTokenListeners.forEach((listener) => listener(currentBleCommandToken));
  return currentBleCommandToken;
}

export function getBleCommandToken() {
  return currentBleCommandToken;
}

export function subscribeBleCommandToken(listener: (token: string) => void) {
  bleCommandTokenListeners.add(listener);
  listener(currentBleCommandToken);
  return () => {
    bleCommandTokenListeners.delete(listener);
  };
}

const NIGHT_VISION_KEY = "codeblack.nightVisionEnabled";
const APP_THEME_KEY = "codeblack.appTheme";
const CLOCK_MODE_KEY = "codeblack.clockMode";
const DISPLAY_SETTINGS_KEY = "codeblack.displaySettings";
const CHASE_TRACKING_SETTINGS_KEY = "codeblack.chaseTrackingSettings";
let currentNightVisionEnabled = false;
const nightVisionListeners = new Set<(enabled: boolean) => void>();
export type AppThemeMode = "dark" | "light" | "night" | "system";
export type ClockMode = "local" | "central" | "zulu";
export type DisplayWakeMode = "normal" | "keep-awake-dim" | "keep-awake-bright";
export type TrackingDetailPreset = "battery-saver" | "balanced" | "high-detail";

export interface DisplaySettings {
  wakeMode: DisplayWakeMode;
  opsBrightness: number;
  autoEnableDuringChase: boolean;
}

export interface ChaseTrackingSettings {
  persistentTrackingEnabled: boolean;
  detailPreset: TrackingDetailPreset;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  wakeMode: "normal",
  opsBrightness: 0.85,
  autoEnableDuringChase: false,
};

export const DEFAULT_CHASE_TRACKING_SETTINGS: ChaseTrackingSettings = {
  persistentTrackingEnabled: true,
  detailPreset: "balanced",
};

let currentAppTheme: AppThemeMode = "dark";
let currentClockMode: ClockMode = "local";
let currentDisplaySettings: DisplaySettings = DEFAULT_DISPLAY_SETTINGS;
let currentChaseTrackingSettings: ChaseTrackingSettings = DEFAULT_CHASE_TRACKING_SETTINGS;
const appThemeListeners = new Set<(mode: AppThemeMode) => void>();
const clockModeListeners = new Set<(mode: ClockMode) => void>();
const displaySettingsListeners = new Set<(settings: DisplaySettings) => void>();
const chaseTrackingSettingsListeners = new Set<(settings: ChaseTrackingSettings) => void>();

function normalizeTheme(value: string | null | undefined): AppThemeMode {
  return value === "light" || value === "night" || value === "system" || value === "dark" ? value : "dark";
}

function normalizeClockMode(value: string | null | undefined): ClockMode {
  return value === "central" || value === "zulu" || value === "local" ? value : "local";
}

function normalizeDisplaySettings(value: unknown): DisplaySettings {
  const source = value && typeof value === "object" ? value as Partial<DisplaySettings> : {};
  const wakeMode = source.wakeMode === "keep-awake-dim" || source.wakeMode === "keep-awake-bright" || source.wakeMode === "normal" ? source.wakeMode : DEFAULT_DISPLAY_SETTINGS.wakeMode;
  const brightness = typeof source.opsBrightness === "number" && Number.isFinite(source.opsBrightness) ? source.opsBrightness : DEFAULT_DISPLAY_SETTINGS.opsBrightness;
  return {
    wakeMode,
    opsBrightness: Math.min(1, Math.max(0.15, brightness)),
    autoEnableDuringChase: typeof source.autoEnableDuringChase === "boolean" ? source.autoEnableDuringChase : DEFAULT_DISPLAY_SETTINGS.autoEnableDuringChase,
  };
}

function normalizeChaseTrackingSettings(value: unknown): ChaseTrackingSettings {
  const source = value && typeof value === "object" ? value as Partial<ChaseTrackingSettings> : {};
  const detailPreset = source.detailPreset === "battery-saver" || source.detailPreset === "high-detail" ? source.detailPreset : DEFAULT_CHASE_TRACKING_SETTINGS.detailPreset;
  return {
    persistentTrackingEnabled: source.persistentTrackingEnabled !== false,
    detailPreset,
  };
}

export async function loadNightVisionEnabled() {
  await loadAppTheme();
  currentNightVisionEnabled = currentAppTheme === "night";
  nightVisionListeners.forEach((listener) => listener(currentNightVisionEnabled));
  return currentNightVisionEnabled;
}

export async function saveNightVisionEnabled(enabled: boolean) {
  await saveAppTheme(enabled ? "night" : "dark");
  await Preferences.set({ key: NIGHT_VISION_KEY, value: String(enabled) });
  nightVisionListeners.forEach((listener) => listener(currentNightVisionEnabled));
  return currentNightVisionEnabled;
}

export function getNightVisionEnabled() {
  return currentNightVisionEnabled;
}

export function subscribeNightVisionEnabled(listener: (enabled: boolean) => void) {
  nightVisionListeners.add(listener);
  listener(currentNightVisionEnabled);
  return () => {
    nightVisionListeners.delete(listener);
  };
}

// Replaced the old flat favoriteBrands string list -- "render matching pins bigger" inside the
// full Gas/Food Overpass feed still showed every other station/restaurant too. This is a curated
// allowlist instead: only a place whose OSM name matches one of these renders on the map at all,
// each with its own color and (optionally) an uploaded logo image, so "that's a Love's" reads at a
// glance instead of just "that's a slightly bigger gas dot."
export interface CustomPoiPin {
  id: string;
  name: string;
  matchText: string;
  color: string;
  imageDataUrl?: string;
}

const CUSTOM_POI_PINS_KEY = "codeblack.customPoiPins";
let currentCustomPoiPins: CustomPoiPin[] = [];
const customPoiPinsListeners = new Set<(pins: CustomPoiPin[]) => void>();

export async function loadCustomPoiPins() {
  const saved = await Preferences.get({ key: CUSTOM_POI_PINS_KEY });
  try {
    currentCustomPoiPins = saved.value ? (JSON.parse(saved.value) as CustomPoiPin[]) : [];
  } catch {
    currentCustomPoiPins = [];
  }
  customPoiPinsListeners.forEach((listener) => listener(currentCustomPoiPins));
  return currentCustomPoiPins;
}

export async function saveCustomPoiPins(pins: CustomPoiPin[]) {
  currentCustomPoiPins = pins;
  await Preferences.set({ key: CUSTOM_POI_PINS_KEY, value: JSON.stringify(currentCustomPoiPins) });
  customPoiPinsListeners.forEach((listener) => listener(currentCustomPoiPins));
  return currentCustomPoiPins;
}

export function getCustomPoiPins() {
  return currentCustomPoiPins;
}

export function subscribeCustomPoiPins(listener: (pins: CustomPoiPin[]) => void) {
  customPoiPinsListeners.add(listener);
  listener(currentCustomPoiPins);
  return () => {
    customPoiPinsListeners.delete(listener);
  };
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

const TELEMETRY_LINK_ENABLED_KEY = "codeblack.telemetryLinkEnabled";
let currentTelemetryLinkEnabled = true;
const telemetryLinkEnabledListeners = new Set<(enabled: boolean) => void>();

// Lets the owner manually stop BLE scanning + HTTP polling entirely -- e.g. Nick's truck testing
// without an ESP32 yet, or the tablet being used off-vehicle -- rather than the link retrying
// forever in the background. Defaults to true (existing always-on behavior) so nobody who already
// has real hardware sees a regression from this being added.
export async function loadTelemetryLinkEnabled() {
  const saved = await Preferences.get({ key: TELEMETRY_LINK_ENABLED_KEY });
  currentTelemetryLinkEnabled = saved.value == null ? true : saved.value === "true";
  telemetryLinkEnabledListeners.forEach((listener) => listener(currentTelemetryLinkEnabled));
  return currentTelemetryLinkEnabled;
}

export async function saveTelemetryLinkEnabled(enabled: boolean) {
  currentTelemetryLinkEnabled = enabled;
  await Preferences.set({ key: TELEMETRY_LINK_ENABLED_KEY, value: String(enabled) });
  telemetryLinkEnabledListeners.forEach((listener) => listener(currentTelemetryLinkEnabled));
  return currentTelemetryLinkEnabled;
}

export function getTelemetryLinkEnabled() {
  return currentTelemetryLinkEnabled;
}

export function subscribeTelemetryLinkEnabled(listener: (enabled: boolean) => void) {
  telemetryLinkEnabledListeners.add(listener);
  listener(currentTelemetryLinkEnabled);
  return () => {
    telemetryLinkEnabledListeners.delete(listener);
  };
}

export async function loadPiEndpoint() {
  const saved = await Preferences.get({ key: PI_ENDPOINT_KEY });
  currentPiEndpoint = normalizeEndpoint(saved.value ?? DEFAULT_PI_ENDPOINT);
  listeners.forEach((listener) => listener(currentPiEndpoint));
  return currentPiEndpoint;
}

export async function savePiEndpoint(value: string) {
  currentPiEndpoint = normalizeEndpoint(value);
  await Preferences.set({ key: PI_ENDPOINT_KEY, value: currentPiEndpoint });
  listeners.forEach((listener) => listener(currentPiEndpoint));
  return currentPiEndpoint;
}

export function getPiEndpoint() {
  return currentPiEndpoint;
}

export function subscribePiEndpoint(listener: (endpoint: string) => void) {
  listeners.add(listener);
  listener(currentPiEndpoint);
  return () => listeners.delete(listener);
}

export interface MapLayerVisibility {
  alerts: boolean;
  team: boolean;
  chasers: boolean;
  poi: boolean;
  mosaic: boolean;
  roadConditions: boolean;
  trafficCameras: boolean;
  probes: boolean;
  chaserNet: boolean;
  breadcrumbs: boolean;
}

const MAP_LAYER_VISIBILITY_KEY = "codeblack.mapLayerVisibility";
const DEFAULT_MAP_LAYER_VISIBILITY: MapLayerVisibility = {
  alerts: true,
  team: true,
  chasers: true,
  poi: true,
  mosaic: true,
  roadConditions: false,
  trafficCameras: false,
  probes: false,
  chaserNet: false,
  breadcrumbs: true,
};

// Was local per-AtlasMap-instance state (the Weather page's compact map and the Locate page's full
// map each kept their own independent copy) until the full-page Layer Config screen needed to
// control it from outside either map instance -- moved to the same shared get/save/subscribe
// pattern as pin styles/team roster so both maps AND the new config screen always agree, and the
// owner's chosen layer set survives an app restart like every other preference in this app does.
let currentMapLayerVisibility: MapLayerVisibility = DEFAULT_MAP_LAYER_VISIBILITY;
const mapLayerVisibilityListeners = new Set<(visibility: MapLayerVisibility) => void>();

export async function loadMapLayerVisibility() {
  const saved = await Preferences.get({ key: MAP_LAYER_VISIBILITY_KEY });
  if (saved.value) {
    try {
      const parsed = JSON.parse(saved.value) as Partial<MapLayerVisibility>;
      currentMapLayerVisibility = { ...DEFAULT_MAP_LAYER_VISIBILITY, ...parsed };
    } catch {
      currentMapLayerVisibility = DEFAULT_MAP_LAYER_VISIBILITY;
    }
  } else {
    currentMapLayerVisibility = DEFAULT_MAP_LAYER_VISIBILITY;
  }
  mapLayerVisibilityListeners.forEach((listener) => listener(currentMapLayerVisibility));
  return currentMapLayerVisibility;
}

export async function saveMapLayerVisibility(visibility: MapLayerVisibility) {
  currentMapLayerVisibility = visibility;
  await Preferences.set({ key: MAP_LAYER_VISIBILITY_KEY, value: JSON.stringify(visibility) });
  mapLayerVisibilityListeners.forEach((listener) => listener(currentMapLayerVisibility));
  return currentMapLayerVisibility;
}

export function getMapLayerVisibility() {
  return currentMapLayerVisibility;
}

export function subscribeMapLayerVisibility(listener: (visibility: MapLayerVisibility) => void) {
  mapLayerVisibilityListeners.add(listener);
  listener(currentMapLayerVisibility);
  return () => {
    mapLayerVisibilityListeners.delete(listener);
  };
}

export async function loadAppTheme() {
  const [themeSaved, legacyNight] = await Promise.all([
    Preferences.get({ key: APP_THEME_KEY }),
    Preferences.get({ key: NIGHT_VISION_KEY }),
  ]);
  currentAppTheme = themeSaved.value ? normalizeTheme(themeSaved.value) : legacyNight.value === "true" ? "night" : "dark";
  currentNightVisionEnabled = currentAppTheme === "night";
  appThemeListeners.forEach((listener) => listener(currentAppTheme));
  nightVisionListeners.forEach((listener) => listener(currentNightVisionEnabled));
  return currentAppTheme;
}

export async function saveAppTheme(mode: AppThemeMode) {
  currentAppTheme = normalizeTheme(mode);
  currentNightVisionEnabled = currentAppTheme === "night";
  await Preferences.set({ key: APP_THEME_KEY, value: currentAppTheme });
  await Preferences.set({ key: NIGHT_VISION_KEY, value: String(currentNightVisionEnabled) });
  appThemeListeners.forEach((listener) => listener(currentAppTheme));
  nightVisionListeners.forEach((listener) => listener(currentNightVisionEnabled));
  return currentAppTheme;
}

export function getAppTheme() {
  return currentAppTheme;
}

export function subscribeAppTheme(listener: (mode: AppThemeMode) => void) {
  appThemeListeners.add(listener);
  listener(currentAppTheme);
  return () => {
    appThemeListeners.delete(listener);
  };
}

export async function loadClockMode() {
  const saved = await Preferences.get({ key: CLOCK_MODE_KEY });
  currentClockMode = normalizeClockMode(saved.value);
  clockModeListeners.forEach((listener) => listener(currentClockMode));
  return currentClockMode;
}

export async function saveClockMode(mode: ClockMode) {
  currentClockMode = normalizeClockMode(mode);
  await Preferences.set({ key: CLOCK_MODE_KEY, value: currentClockMode });
  clockModeListeners.forEach((listener) => listener(currentClockMode));
  return currentClockMode;
}

export function subscribeClockMode(listener: (mode: ClockMode) => void) {
  clockModeListeners.add(listener);
  listener(currentClockMode);
  return () => {
    clockModeListeners.delete(listener);
  };
}

export async function loadDisplaySettings() {
  const saved = await Preferences.get({ key: DISPLAY_SETTINGS_KEY });
  try {
    currentDisplaySettings = normalizeDisplaySettings(saved.value ? JSON.parse(saved.value) : DEFAULT_DISPLAY_SETTINGS);
  } catch {
    currentDisplaySettings = DEFAULT_DISPLAY_SETTINGS;
  }
  displaySettingsListeners.forEach((listener) => listener(currentDisplaySettings));
  return currentDisplaySettings;
}

export async function saveDisplaySettings(settings: DisplaySettings) {
  currentDisplaySettings = normalizeDisplaySettings(settings);
  await Preferences.set({ key: DISPLAY_SETTINGS_KEY, value: JSON.stringify(currentDisplaySettings) });
  displaySettingsListeners.forEach((listener) => listener(currentDisplaySettings));
  return currentDisplaySettings;
}

export function subscribeDisplaySettings(listener: (settings: DisplaySettings) => void) {
  displaySettingsListeners.add(listener);
  listener(currentDisplaySettings);
  return () => {
    displaySettingsListeners.delete(listener);
  };
}

export async function loadChaseTrackingSettings() {
  const saved = await Preferences.get({ key: CHASE_TRACKING_SETTINGS_KEY });
  try {
    currentChaseTrackingSettings = normalizeChaseTrackingSettings(saved.value ? JSON.parse(saved.value) : DEFAULT_CHASE_TRACKING_SETTINGS);
  } catch {
    currentChaseTrackingSettings = DEFAULT_CHASE_TRACKING_SETTINGS;
  }
  chaseTrackingSettingsListeners.forEach((listener) => listener(currentChaseTrackingSettings));
  return currentChaseTrackingSettings;
}

export async function saveChaseTrackingSettings(settings: ChaseTrackingSettings) {
  currentChaseTrackingSettings = normalizeChaseTrackingSettings(settings);
  await Preferences.set({ key: CHASE_TRACKING_SETTINGS_KEY, value: JSON.stringify(currentChaseTrackingSettings) });
  chaseTrackingSettingsListeners.forEach((listener) => listener(currentChaseTrackingSettings));
  return currentChaseTrackingSettings;
}

export function subscribeChaseTrackingSettings(listener: (settings: ChaseTrackingSettings) => void) {
  chaseTrackingSettingsListeners.add(listener);
  listener(currentChaseTrackingSettings);
  return () => {
    chaseTrackingSettingsListeners.delete(listener);
  };
}
