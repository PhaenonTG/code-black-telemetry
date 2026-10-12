export type OpsDataMode = "LIVE_CORE" | "SIMULATION";

function cleanUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function modeFromEnv(value: unknown): OpsDataMode {
  return value === "SIMULATION" ? "SIMULATION" : "LIVE_CORE";
}

export interface OpsCoreConfig {
  mode: OpsDataMode;
  coreBaseUrl: string;
  coreWsUrl: string;
  unitId: string;
  stormIntelPollSeconds: number;
}

export function readOpsCoreConfig(env: Record<string, unknown> = import.meta.env): OpsCoreConfig {
  // Production OPS is served by the same Pages Worker that owns the authenticated
  // /api/core allowlist.  A blank build-time value used to leave the entire UI in
  // "LIVE_CORE" mode while silently giving it no route to Core at all.  Keep an
  // explicit value authoritative for local/tunnel development, but make the
  // same-origin protected gateway the safe production default.
  const explicitCoreBaseUrl = cleanUrl(env.VITE_CODEBLACK_CORE_BASE_URL);
  const coreBaseUrl = explicitCoreBaseUrl || "/api/core";
  const explicitWs = cleanUrl(env.VITE_CODEBLACK_CORE_WS_URL);
  // The Pages gateway is HTTP-only by design.  Infer a WebSocket endpoint only
  // for an explicit absolute Core URL; REST polling remains fully functional
  // through the authenticated gateway.
  const inferredWs = explicitCoreBaseUrl.startsWith("https://")
    ? `wss://${explicitCoreBaseUrl.slice("https://".length)}`
    : explicitCoreBaseUrl.startsWith("http://")
      ? `ws://${explicitCoreBaseUrl.slice("http://".length)}`
      : "";
  const pollSeconds = Number(env.VITE_CODEBLACK_STORM_INTEL_POLL_SECONDS ?? 30);

  return {
    mode: modeFromEnv(env.VITE_OPS_DATA_MODE),
    coreBaseUrl,
    coreWsUrl: explicitWs || inferredWs,
    unitId: typeof env.VITE_CODEBLACK_DEFAULT_UNIT_ID === "string" && env.VITE_CODEBLACK_DEFAULT_UNIT_ID.trim()
      ? env.VITE_CODEBLACK_DEFAULT_UNIT_ID.trim()
      : "cbwx-unit-striker",
    stormIntelPollSeconds: Number.isFinite(pollSeconds) ? Math.min(300, Math.max(5, pollSeconds)) : 30,
  };
}

export function coreConfigured(config: OpsCoreConfig): boolean {
  return config.mode === "LIVE_CORE" && Boolean(config.coreBaseUrl);
}
