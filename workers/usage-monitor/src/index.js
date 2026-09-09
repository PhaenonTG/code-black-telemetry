// Checks the account's Workers request volume for the current UTC day against the free-plan
// daily cap (100,000 requests, shared across every Worker on the account) and posts a Discord
// alert into #infrastructure-alerts when it's approaching that cap. Runs on a cron trigger; also
// exposes a GET so it can be checked/tested on demand without waiting for the next tick.
//
// Needs two secrets, set via `wrangler secret put`:
//   CF_API_TOKEN        -- a Cloudflare API token scoped to "Account Analytics: Read" for this
//                           account. The token wrangler itself uses (see `wrangler whoami`)
//                           does NOT have this scope, so a dedicated token has to be created by
//                           hand in the dashboard (My Profile -> API Tokens -> Create Token ->
//                           custom token -> Account / Account Analytics / Read) and set here.
//   DISCORD_WEBHOOK_URL  -- reuses the "Stream Watchdog" webhook already posting to
//                           #infrastructure-alerts in the Code Black WX Discord.
// Until CF_API_TOKEN is set, every run logs a clear reason and exits quietly -- no Discord spam
// for a known-pending setup step, and the cron/webhook plumbing is still verifiably live via the
// GET endpoint even before that token exists.

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

async function fetchTodaysWorkerRequests(accountId, apiToken) {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const query = `
    query($accountTag: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 1
            filter: { datetime_geq: $since, datetime_leq: $until }
          ) {
            sum { requests }
          }
        }
      }
    }`;
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { accountTag: accountId, since: dayStart.toISOString(), until: now.toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  const rows = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  return rows.reduce((sum, row) => sum + (row.sum?.requests ?? 0), 0);
}

async function postDiscordAlert(webhookUrl, { level, requests, limit, pct }) {
  const isCritical = level === "critical";
  const embed = {
    title: `${isCritical ? "🔴" : "🟡"} Cloudflare Workers usage ${isCritical ? "critical" : "warning"}`,
    description: `Account-wide Workers requests today: **${requests.toLocaleString()}** / ${limit.toLocaleString()} (**${pct}%**) of the free-plan daily cap.`,
    color: isCritical ? 15158332 : 15844367,
    fields: [
      { name: "What to check", value: "Cloudflare dashboard -> Workers & Pages -> Analytics, to see which Worker is driving it.", inline: false },
      { name: "Known levers", value: "radar-relay edge-caches tiles/frames already -- if it's climbing again, check for new uncached hot paths, or raise cache TTLs further before considering the $5/mo Workers Paid plan.", inline: false },
    ],
    footer: { text: "codeblack-usage-monitor" },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

async function runCheck(env) {
  if (!env.CF_API_TOKEN) {
    return { skipped: true, reason: "CF_API_TOKEN not set yet -- see the comment at the top of src/index.js for how to create one." };
  }
  if (!env.DISCORD_WEBHOOK_URL) {
    return { skipped: true, reason: "DISCORD_WEBHOOK_URL not set." };
  }

  const limit = Number(env.DAILY_REQUEST_LIMIT || 100000);
  const warnPct = Number(env.WARN_THRESHOLD_PCT || 70);
  const criticalPct = Number(env.CRITICAL_THRESHOLD_PCT || 90);

  const requests = await fetchTodaysWorkerRequests(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
  const pct = Math.round((requests / limit) * 1000) / 10;

  let level = null;
  if (pct >= criticalPct) level = "critical";
  else if (pct >= warnPct) level = "warning";

  if (level) {
    await postDiscordAlert(env.DISCORD_WEBHOOK_URL, { level, requests, limit, pct });
  }

  return { skipped: false, requests, limit, pct, level };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
  async fetch(request, env) {
    const result = await runCheck(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
