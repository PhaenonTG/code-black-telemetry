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
  const coreBaseUrl = cleanUrl(env.VITE_CODEBLACK_CORE_BASE_URL);
  const explicitWs = cleanUrl(env.VITE_CODEBLACK_CORE_WS_URL);
  const inferredWs = coreBaseUrl.startsWith("https://")
    ? `wss://${coreBaseUrl.slice("https://".length)}`
    : coreBaseUrl.startsWith("http://")
      ? `ws://${coreBaseUrl.slice("http://".length)}`
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
