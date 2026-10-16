import { createHash } from "node:crypto";
import { verifyOpsAuth, type AuthResult, type GatewayEnv } from "../functions/lib/coreGateway";

export const AUTH_DEADLINE_MS = 6_000;
const pendingByFetcher = new WeakMap<typeof fetch, Map<string, Promise<AuthResult>>>();

// Share only checks currently in flight. Never cache a successful permission verdict.
export function verifyPrivateAuth(request: Request, env: GatewayEnv, fetchImpl: typeof fetch): Promise<AuthResult> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return verifyOpsAuth(authorization, env, fetchImpl);
  let pending = pendingByFetcher.get(fetchImpl);
  if (!pending) { pending = new Map(); pendingByFetcher.set(fetchImpl, pending); }
  const key = createHash("sha256").update(JSON.stringify([env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization])).digest("hex");
  const existing = pending.get(key);
  if (existing) return existing;
  const unavailable: AuthResult = { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  if (pending.size >= 64) return Promise.resolve(unavailable);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<AuthResult>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(unavailable); }, AUTH_DEADLINE_MS);
  });
  const boundedFetch = ((input, init) => fetchImpl(input, { ...init, signal: controller.signal })) as typeof fetch;
  const work = Promise.race([verifyOpsAuth(authorization, env, boundedFetch), deadline])
    .catch(() => unavailable)
    .then((result) => controller.signal.aborted ? unavailable : result)
    .finally(() => { clearTimeout(timer); pending!.delete(key); });
  pending.set(key, work);
  return work;
}
