import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";

const W = 1600, H = 2100;
const ink = "#eef5f5", muted = "#a3b8c1", cyan = "#45d9d1", coral = "#fb716a";

function wrap(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  let line = "", count = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) { line = next; continue; }
    ctx.fillText(line, x, y + count * lineHeight);
    line = word;
    count++;
    if (count >= maxLines) break;
  }
  if (count < maxLines && line) { ctx.fillText(line, x, y + count * lineHeight); count++; }
  return count * lineHeight;
}

export async function saveBriefingImage(data: PublicHurricane, mapPng: string | null) {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas is unavailable");
  ctx.fillStyle = "#06121c"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cyan; ctx.fillRect(80, 72, 72, 8);
  ctx.fillStyle = ink; ctx.font = "700 30px system-ui"; ctx.fillText("CODE BLACK  /  AEGIS", 80, 128);
  ctx.font = "800 70px system-ui"; ctx.fillText(`Hurricane ${data.storm.name ?? "watch"}`, 80, 225);
  ctx.fillStyle = muted; ctx.font = "28px system-ui"; ctx.fillText(`Updated ${displayTime(data.checked_at)}  •  NHC ${displayTime(data.storm.last_update)}`, 80, 277);
  ctx.fillStyle = "#102535"; ctx.fillRect(80, 318, 1440, 138);
  const metrics = [
    ["MAX WIND", data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`], ["PRESSURE", data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`],
    ["48H MODEL SPREAD", data.guidance.spread_48h_miles == null ? "—" : `${data.guidance.spread_48h_miles} mi`],
  ];
  metrics.forEach(([label, value], i) => { const x = 110 + i * 470; ctx.fillStyle = muted; ctx.font = "700 20px system-ui"; ctx.fillText(label, x, 360); ctx.fillStyle = ink; ctx.font = "700 39px system-ui"; ctx.fillText(value, x, 418); });
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("Aegis model synthesis", 80, 530);
  ctx.fillStyle = muted; ctx.font = "25px system-ui"; ctx.fillText("Experimental center-track blend  /  Official NHC forecast shown separately", 80, 571);
  ctx.fillStyle = "#0d2331"; ctx.fillRect(80, 610, 1440, 800);
  if (mapPng) { const image = new Image(); image.src = mapPng; await image.decode(); ctx.drawImage(image, 80, 610, 1440, 800); }
  else { ctx.fillStyle = muted; ctx.font = "30px system-ui"; ctx.fillText("Map image unavailable — consult the live briefing for tracks.", 140, 1000); }
  ctx.fillStyle = "#0b1c29"; ctx.fillRect(80, 1326, 650, 84);
  ctx.fillStyle = cyan; ctx.font = "700 21px system-ui"; ctx.fillText("━━  AEGIS EXPERIMENTAL", 104, 1378);
  ctx.fillStyle = "#0b1c29"; ctx.fillRect(750, 1326, 770, 84);
  ctx.fillStyle = ink; ctx.fillText("┄┄  NHC OFFICIAL FORECAST", 775, 1378);
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("What the data says", 80, 1496);
  ctx.fillStyle = muted; ctx.font = "26px system-ui";
  let y = 1550;
  const evidence = [
    `Projection uses ${data.projection.member_ids?.length ?? 0} independent model aids: ${data.projection.member_ids?.join(", ") ?? "none available"}.`,
    `Model center spread at 48 hours: ${data.guidance.spread_48h_miles == null ? "not available" : `${data.guidance.spread_48h_miles} miles`}. Spread is not a probability cone.`,
    `Observed wind change: ${signed(data.observed.trend.wind_change_mph, "mph")} over ${data.observed.trend.period_hours ?? "?"} hours.`,
  ];
  for (const item of evidence) { ctx.fillStyle = cyan; ctx.fillRect(80, y - 17, 10, 10); ctx.fillStyle = ink; y += wrap(ctx, item, 112, y, 1390, 39, 2) + 20; }
  if (data.regional_alerts.length) {
    ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("MOBILE COASTAL-AREA ALERT", 80, y + 27);
    ctx.fillStyle = ink; ctx.font = "26px system-ui";
    wrap(ctx, data.regional_alerts.map((item) => item.event).filter(Boolean).join("  •  "), 80, y + 72, 1400, 36, 2);
  }
  ctx.fillStyle = coral; ctx.font = "700 26px system-ui"; ctx.fillText("EXPERIMENTAL — NOT AN OFFICIAL FORECAST", 80, 1840);
  ctx.fillStyle = muted; ctx.font = "24px system-ui";
  wrap(ctx, data.disclosure, 80, 1885, 1430, 34, 2);
  ctx.fillText("Official source: nhc.noaa.gov  •  Weather alerts: weather.gov", 80, 2015);
  ctx.fillText("hurricane.codeblackwx.com", 80, 2055);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image generation failed")), "image/png"));
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `codeblack-aegis-hurricane-${data.storm.name?.toLowerCase() ?? "watch"}.png`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
