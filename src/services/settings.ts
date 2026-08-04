import { Preferences } from "@capacitor/preferences";

const PI_ENDPOINT_KEY = "codeblack.piEndpoint";
const DEFAULT_PI_ENDPOINT = "";

let currentPiEndpoint = DEFAULT_PI_ENDPOINT;
const listeners = new Set<(endpoint: string) => void>();

const CHASER_RADIUS_KEY = "codeblack.chaserRadiusMiles";
export const DEFAULT_CHASER_RADIUS_MILES = 100;
const MIN_CHASER_RADIUS_MILES = 5;
const MAX_CHASER_RADIUS_MILES = 500;

let currentChaserRadiusMiles = DEFAULT_CHASER_RADIUS_MILES;
const chaserRadiusListeners = new Set<(radiusMiles: number) => void>();

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

export type PinShape = "circle" | "diamond" | "triangle" | "star" | "square";

export interface PinStyle {
  color: string;
  shape: PinShape;
}

const TEAM_MEMBERS_KEY = "codeblack.teamMembers";
const TEAM_PIN_STYLE_KEY = "codeblack.teamPinStyle";
const CHASER_PIN_STYLE_KEY = "codeblack.chaserPinStyle";
// Green is unclaimed anywhere else in this app's palette and conventionally reads as
// "friendly/team" on a tactical map -- distinct from red (warnings + your own vehicle) and amber
// (watches). Chasers default to a muted, informational white/grey. Both are just starting points;
// full override lives in Settings.
const DEFAULT_TEAM_PIN_STYLE: PinStyle = { color: "#3ddc70", shape: "diamond" };
const DEFAULT_CHASER_PIN_STYLE: PinStyle = { color: "#c7ccd6", shape: "circle" };

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
        if (parsed.color && parsed.shape) next = { color: parsed.color, shape: parsed.shape };
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

// Vehicle marker adds a sixth "custom" shape on top of the five PinShape options -- an uploaded,
// downscaled-to-a-small-square photo/icon instead of a solid color shape. `imageDataUrl` only means
// anything when shape is "custom"; `color` still applies to the accuracy ring/pulse/heading line
// regardless of shape, so switching to a custom image doesn't lose the color identity.
export type VehicleMarkerShape = PinShape | "custom";

export interface VehicleMarkerStyle {
  color: string;
  shape: VehicleMarkerShape;
  imageDataUrl?: string;
}

const VEHICLE_MARKER_STYLE_KEY = "codeblack.vehicleMarkerStyle";
const DEFAULT_VEHICLE_MARKER_STYLE: VehicleMarkerStyle = { color: "#ff2d35", shape: "circle" };

let currentVehicleMarkerStyle: VehicleMarkerStyle = DEFAULT_VEHICLE_MARKER_STYLE;
const vehicleMarkerStyleListeners = new Set<(style: VehicleMarkerStyle) => void>();

export async function loadVehicleMarkerStyle() {
  const saved = await Preferences.get({ key: VEHICLE_MARKER_STYLE_KEY });
  let next = DEFAULT_VEHICLE_MARKER_STYLE;
  if (saved.value) {
    try {
      const parsed = JSON.parse(saved.value) as Partial<VehicleMarkerStyle>;
      if (parsed.color && parsed.shape) next = { color: parsed.color, shape: parsed.shape, imageDataUrl: parsed.imageDataUrl };
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
let currentNightVisionEnabled = false;
const nightVisionListeners = new Set<(enabled: boolean) => void>();

export async function loadNightVisionEnabled() {
  const saved = await Preferences.get({ key: NIGHT_VISION_KEY });
  currentNightVisionEnabled = saved.value === "true";
  nightVisionListeners.forEach((listener) => listener(currentNightVisionEnabled));
  return currentNightVisionEnabled;
}

export async function saveNightVisionEnabled(enabled: boolean) {
  currentNightVisionEnabled = enabled;
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

const FAVORITE_BRANDS_KEY = "codeblack.favoriteBrands";
// Case-insensitive substring match against a POI's OSM name (see AtlasPoiLayer.ts) -- lets the
// owner call out specific preferred chains (Love's, Buc-ee's, Taco Bell, Braum's, etc.) so those
// pins stand out from the rest of the Gas/Food POI layer on the map. Same shape as teamRoster
// (plain string list, JSON in Preferences) since it's the same kind of "curated list filtering a
// broader feed" pattern.
let currentFavoriteBrands: string[] = [];
const favoriteBrandsListeners = new Set<(brands: string[]) => void>();

export async function loadFavoriteBrands() {
  const saved = await Preferences.get({ key: FAVORITE_BRANDS_KEY });
  try {
    currentFavoriteBrands = saved.value ? (JSON.parse(saved.value) as string[]) : [];
  } catch {
    currentFavoriteBrands = [];
  }
  favoriteBrandsListeners.forEach((listener) => listener(currentFavoriteBrands));
  return currentFavoriteBrands;
}

export async function saveFavoriteBrands(brands: string[]) {
  currentFavoriteBrands = brands.map((entry) => entry.trim()).filter(Boolean);
  await Preferences.set({ key: FAVORITE_BRANDS_KEY, value: JSON.stringify(currentFavoriteBrands) });
  favoriteBrandsListeners.forEach((listener) => listener(currentFavoriteBrands));
  return currentFavoriteBrands;
}

export function getFavoriteBrands() {
  return currentFavoriteBrands;
}

export function subscribeFavoriteBrands(listener: (brands: string[]) => void) {
  favoriteBrandsListeners.add(listener);
  listener(currentFavoriteBrands);
  return () => {
    favoriteBrandsListeners.delete(listener);
  };
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
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
}

const MAP_LAYER_VISIBILITY_KEY = "codeblack.mapLayerVisibility";
const DEFAULT_MAP_LAYER_VISIBILITY: MapLayerVisibility = { alerts: true, team: true, chasers: true, poi: true, mosaic: true };

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
