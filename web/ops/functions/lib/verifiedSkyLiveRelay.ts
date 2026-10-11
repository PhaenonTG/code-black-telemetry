export const VERIFIED_SKY_LIVE_PATH = "/api/verified-sky-live";
const CFHT_VIDEO_ID = "Q3UhCgsWDw8";

export async function handleVerifiedSkyLive(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405 });
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${CFHT_VIDEO_ID}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CodeBlackWX/1.0)", Accept: "text/html" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("YouTube unavailable");
    const html = await response.text();
    const live = html.includes('"isLiveNow":true') && html.includes('"playabilityStatus":{"status":"OK"');
    return new Response(JSON.stringify({ live, checkedAt: Date.now() }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return new Response(JSON.stringify({ live: false, checkedAt: Date.now() }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
