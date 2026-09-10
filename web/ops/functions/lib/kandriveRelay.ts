const KANDRIVE_PATH = "/api/kandrive/graphql";
const KANDRIVE_UPSTREAM = "https://www.kandrive.gov/api/graphql";
const MAX_BODY_BYTES = 24_000;

export async function handleKandriveRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  if (url.pathname !== KANDRIVE_PATH) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  const body = await request.text();
  if (!body || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  let parsed: { query?: unknown; variables?: unknown };
  try { parsed = JSON.parse(body); } catch { return Response.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  if (typeof parsed.query !== "string" || !parsed.query.includes("mapFeaturesQuery") || typeof parsed.variables !== "object" || parsed.variables === null) return Response.json({ error: "QUERY_NOT_ALLOWED" }, { status: 400 });
  try {
    const upstream = await fetch(KANDRIVE_UPSTREAM, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "CodeBlackOPS/1.0" }, body });
    if (!upstream.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    return new Response(upstream.body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=30", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}
