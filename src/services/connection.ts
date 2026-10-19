export type ConnectionState = "NOT_CONFIGURED" | "CONNECTING" | "CONNECTED" | "DEGRADED" | "STALE" | "DISCONNECTED" | "ERROR";
export type ConnectionTransport = "http" | "https" | "ble" | "local-network" | "tailscale" | "unknown";
export type ConnectionErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_ENDPOINT"
  | "INVALID_SCHEME"
  | "DNS_FAILURE"
  | "CONNECTION_REFUSED"
  | "TIMEOUT"
  | "TLS_FAILURE"
  | "HTTP_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "MALFORMED_RESPONSE"
  | "ABORTED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface EndpointNormalizationResult {
  ok: boolean;
  endpoint: string;
  errorCode?: ConnectionErrorCode;
  errorSummary?: string;
}

export interface ConnectionStatus {
  endpoint: string;
  connectionState: ConnectionState;
  lastAttemptAt: number | null;
  lastConnectedAt: number | null;
  lastSuccessfulResponseAt: number | null;
  lastDataAt: number | null;
  dataAgeMs: number | null;
  latencyMs: number | null;
  failureCount: number;
  lastErrorCode: ConnectionErrorCode | null;
  lastErrorSummary: string;
  retryAt: number | null;
  provider: "codeblack-core" | "vehicle-node" | "streaming" | "telemetry" | "unknown";
  transport: ConnectionTransport;
  isConfigured: boolean;
}

export interface ConnectionTestResult {
  status: ConnectionStatus;
  httpStatus: number | null;
  serviceHealthy: boolean | null;
  message: string;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
}

const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseMs: 1_500,
  maxMs: 45_000,
  jitterRatio: 0.18,
};

const LOCAL_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^192\.168\.)|(\.local$)/i;
const TAILSCALE_RE = /^100\./;

export function normalizeEndpointInput(value: string): EndpointNormalizationResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, endpoint: "" };
  if (/^(javascript|file|data|blob|ftp|ws|wss):/i.test(trimmed)) {
    return {
      ok: false,
      endpoint: "",
      errorCode: "INVALID_SCHEME",
      errorSummary: "Only HTTP or HTTPS endpoints are allowed.",
    };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      endpoint: "",
      errorCode: "INVALID_ENDPOINT",
      errorSummary: "Endpoint is not a valid host or URL.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      endpoint: "",
      errorCode: "INVALID_SCHEME",
      errorSummary: "Only HTTP or HTTPS endpoints are allowed.",
    };
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return {
      ok: false,
      endpoint: "",
      errorCode: "INVALID_ENDPOINT",
      errorSummary: "Endpoint must include a host and cannot include credentials.",
    };
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return { ok: true, endpoint: parsed.toString().replace(/\/$/, "") };
}

export function normalizeEndpointOrEmpty(value: string): string {
  const result = normalizeEndpointInput(value);
  return result.ok ? result.endpoint : "";
}

export function inferConnectionTransport(endpoint: string): ConnectionTransport {
  if (!endpoint) return "unknown";
  try {
    const url = new URL(endpoint);
    if (TAILSCALE_RE.test(url.hostname)) return "tailscale";
    if (LOCAL_HOST_RE.test(url.hostname)) return "local-network";
    return url.protocol === "https:" ? "https" : "http";
  } catch {
    return "unknown";
  }
}

export function createConnectionStatus(partial: Partial<ConnectionStatus> = {}): ConnectionStatus {
  const endpoint = partial.endpoint ?? "";
  return {
    endpoint,
    connectionState: partial.connectionState ?? (endpoint ? "DISCONNECTED" : "NOT_CONFIGURED"),
    lastAttemptAt: partial.lastAttemptAt ?? null,
    lastConnectedAt: partial.lastConnectedAt ?? null,
    lastSuccessfulResponseAt: partial.lastSuccessfulResponseAt ?? null,
    lastDataAt: partial.lastDataAt ?? null,
    dataAgeMs: partial.dataAgeMs ?? null,
    latencyMs: partial.latencyMs ?? null,
    failureCount: partial.failureCount ?? 0,
    lastErrorCode: partial.lastErrorCode ?? null,
    lastErrorSummary: partial.lastErrorSummary ?? "",
    retryAt: partial.retryAt ?? null,
    provider: partial.provider ?? "unknown",
    transport: partial.transport ?? inferConnectionTransport(endpoint),
    isConfigured: partial.isConfigured ?? Boolean(endpoint),
  };
}

export function classifyFetchError(error: unknown): Pick<ConnectionStatus, "connectionState" | "lastErrorCode" | "lastErrorSummary"> {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (name === "AbortError" || lower.includes("abort")) {
    return { connectionState: "DISCONNECTED", lastErrorCode: "TIMEOUT", lastErrorSummary: "Timed out waiting for a response." };
  }
  if (lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")) {
    return { connectionState: "ERROR", lastErrorCode: "TLS_FAILURE", lastErrorSummary: "TLS or certificate check failed." };
  }
  if (lower.includes("refused") || lower.includes("econnrefused")) {
    return { connectionState: "DISCONNECTED", lastErrorCode: "CONNECTION_REFUSED", lastErrorSummary: "Host refused the connection." };
  }
  if (lower.includes("dns") || lower.includes("name_not_resolved") || lower.includes("enotfound")) {
    return { connectionState: "DISCONNECTED", lastErrorCode: "DNS_FAILURE", lastErrorSummary: "Host name could not be resolved." };
  }
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("load failed")) {
    return { connectionState: "DISCONNECTED", lastErrorCode: "NETWORK_ERROR", lastErrorSummary: "Network request failed." };
  }
  return { connectionState: "ERROR", lastErrorCode: "UNKNOWN", lastErrorSummary: "Connection failed." };
}

export function classifyHttpStatus(status: number, statusText = ""): Pick<ConnectionStatus, "connectionState" | "lastErrorCode" | "lastErrorSummary"> {
  if (status === 401) return { connectionState: "ERROR", lastErrorCode: "AUTH_REQUIRED", lastErrorSummary: "Authentication required." };
  if (status === 403) return { connectionState: "ERROR", lastErrorCode: "AUTH_FAILED", lastErrorSummary: "Authentication rejected." };
  return {
    connectionState: status >= 500 ? "DEGRADED" : "ERROR",
    lastErrorCode: "HTTP_ERROR",
    lastErrorSummary: `HTTP ${status}${statusText ? ` ${statusText}` : ""}`,
  };
}

export function nextBackoffDelayMs(failureCount: number, options: BackoffOptions = {}) {
  const config = { ...DEFAULT_BACKOFF, ...options };
  const exponent = Math.max(0, Math.min(8, failureCount - 1));
  const raw = Math.min(config.maxMs, config.baseMs * 2 ** exponent);
  const jitter = raw * config.jitterRatio;
  return Math.round(raw - jitter + Math.random() * jitter * 2);
}

export function dataFreshnessState(dataAt: number | null, now = Date.now(), staleMs = 30_000, offlineMs = 180_000): ConnectionState {
  if (!dataAt) return "DISCONNECTED";
  const age = now - dataAt;
  if (age <= staleMs) return "CONNECTED";
  if (age <= offlineMs) return "STALE";
  return "DISCONNECTED";
}

export async function fetchWithTimeout(url: string, timeoutMs: number, options: RequestInit = {}) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function testHttpConnection(endpoint: string, path = "/health", timeoutMs = 3_500): Promise<ConnectionTestResult> {
  const normalized = normalizeEndpointInput(endpoint);
  const now = Date.now();
  if (!normalized.ok) {
    const status = createConnectionStatus({
      endpoint: "",
      connectionState: "ERROR",
      lastAttemptAt: now,
      lastErrorCode: normalized.errorCode ?? "INVALID_ENDPOINT",
      lastErrorSummary: normalized.errorSummary ?? "Invalid endpoint.",
    });
    return { status, httpStatus: null, serviceHealthy: null, message: status.lastErrorSummary };
  }
  if (!normalized.endpoint) {
    const status = createConnectionStatus({
      connectionState: "NOT_CONFIGURED",
      lastAttemptAt: now,
      lastErrorCode: "NOT_CONFIGURED",
      lastErrorSummary: "Endpoint is not configured.",
    });
    return { status, httpStatus: null, serviceHealthy: null, message: "Endpoint is not configured." };
  }
  const url = `${normalized.endpoint}${path.startsWith("/") ? path : `/${path}`}`;
  const start = performance.now();
  try {
    const response = await fetchWithTimeout(url, timeoutMs, { headers: { Accept: "application/json, text/plain;q=0.8, */*;q=0.5" } });
    const latencyMs = Math.round(performance.now() - start);
    if (!response.ok) {
      const classified = classifyHttpStatus(response.status, response.statusText);
      return {
        status: createConnectionStatus({
          endpoint: normalized.endpoint,
          connectionState: classified.connectionState,
          lastAttemptAt: now,
          latencyMs,
          failureCount: 1,
          lastErrorCode: classified.lastErrorCode,
          lastErrorSummary: classified.lastErrorSummary,
          provider: "vehicle-node",
        }),
        httpStatus: response.status,
        serviceHealthy: false,
        message: classified.lastErrorSummary,
      };
    }
    return {
      status: createConnectionStatus({
        endpoint: normalized.endpoint,
        connectionState: "CONNECTED",
        lastAttemptAt: now,
        lastConnectedAt: Date.now(),
        lastSuccessfulResponseAt: Date.now(),
        lastDataAt: Date.now(),
        dataAgeMs: 0,
        latencyMs,
        provider: "vehicle-node",
      }),
      httpStatus: response.status,
      serviceHealthy: true,
      message: `Health check OK (${latencyMs} ms).`,
    };
  } catch (error) {
    const classified = classifyFetchError(error);
    return {
      status: createConnectionStatus({
        endpoint: normalized.endpoint,
        connectionState: classified.connectionState,
        lastAttemptAt: now,
        failureCount: 1,
        lastErrorCode: classified.lastErrorCode,
        lastErrorSummary: classified.lastErrorSummary,
        provider: "vehicle-node",
      }),
      httpStatus: null,
      serviceHealthy: null,
      message: classified.lastErrorSummary,
    };
  }
}
