import type { PublicHurricane } from "./types";
import { displayTime, signed } from "./types";
import { watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";

const W = 1600, H = 2300;
const ink = "#f4f6fa", muted = "#a3a7b1", cyan = "#45d9d1", coral = "#ff2a0c";

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

export async function saveBriefingImage(data: PublicHurricane, mapPng: string | null, watch: WatchLocation, alerts: PointAlert[], alertsStatus: string) {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas is unavailable");
  ctx.fillStyle = "#020203"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = coral; ctx.fillRect(80, 37, 72, 8);
  const shield = new Image(); shield.src = codeblackShield; await shield.decode(); ctx.drawImage(shield, 80, 55, 42, 70);
  ctx.fillStyle = ink; ctx.font = "800 30px system-ui"; ctx.fillText("CODE BLACK  /  AEGIS", 142, 87);
  ctx.fillStyle = muted; ctx.font = "700 16px system-ui"; ctx.fillText("FROM WATCHING TO WARNING", 144, 115);
  ctx.fillStyle = ink; ctx.font = "800 70px system-ui"; ctx.fillText(`Hurricane ${data.storm.name ?? "watch"}`, 80, 225);
  ctx.fillStyle = muted; ctx.font = "28px system-ui"; ctx.fillText(`Updated ${displayTime(data.checked_at)}  •  NHC ${displayTime(data.storm.last_update)}`, 80, 277);
  ctx.fillStyle = "#111216"; ctx.fillRect(80, 318, 1440, 138);
  const metrics = [
    ["MAX WIND", data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`], ["PRESSURE", data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`],
    ["48H MODEL SPREAD", data.guidance.spread_48h_miles == null ? "—" : `${data.guidance.spread_48h_miles} mi`],
  ];
  metrics.forEach(([label, value], i) => { const x = 110 + i * 470; ctx.fillStyle = muted; ctx.font = "700 20px system-ui"; ctx.fillText(label, x, 360); ctx.fillStyle = ink; ctx.font = "700 39px system-ui"; ctx.fillText(value, x, 418); });
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("Aegis model synthesis", 80, 530);
  ctx.fillStyle = muted; ctx.font = "25px system-ui"; ctx.fillText("Experimental center-track blend  /  Official NHC forecast shown separately", 80, 571);
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(80, 610, 1440, 800);
  if (mapPng) { const image = new Image(); image.src = mapPng; await image.decode(); ctx.drawImage(image, 80, 610, 1440, 800); }
  else { ctx.fillStyle = muted; ctx.font = "30px system-ui"; ctx.fillText("Map image unavailable — consult the live briefing for tracks.", 140, 1000); }
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(80, 1326, 650, 84);
  ctx.fillStyle = cyan; ctx.font = "700 21px system-ui"; ctx.fillText("━━  AEGIS EXPERIMENTAL", 104, 1378);
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(750, 1326, 770, 84);
  ctx.fillStyle = ink; ctx.fillText("┄┄  NHC OFFICIAL FORECAST", 775, 1378);
  const proximity = watchSummary(data, watch);
  ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("WATCH LOCATION", 80, 1470);
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; wrap(ctx, watch.label, 80, 1518, 1430, 42, 2);
  ctx.fillStyle = muted; ctx.font = "25px system-ui";
  ctx.fillText(`Current center: ${proximity.currentMiles == null ? "unavailable" : `${proximity.currentMiles} mi away`}   •   Closest NHC center: ${proximity.official ? `${proximity.official.miles} mi at +${proximity.official.point.hour}h` : "unavailable"}`, 80, 1620);
  ctx.fillText(`Closest Aegis blended center: ${proximity.aegis ? `${proximity.aegis.miles} mi at +${proximity.aegis.point.hour}h` : "unavailable"}   •   Center distance does not predict local impacts.`, 80, 1662);
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("What the data says", 80, 1730);
  ctx.fillStyle = muted; ctx.font = "26px system-ui";
  let y = 1784;
  const evidence = [
    `Projection uses ${data.projection.member_ids?.length ?? 0} independent model aids: ${data.projection.member_ids?.join(", ") ?? "none available"}.`,
    `48-hour center spread: ${data.guidance.spread_48h_miles == null ? "not available" : `${data.guidance.spread_48h_miles} mi`}; not a probability cone. Observed wind change: ${signed(data.observed.trend.wind_change_mph, "mph")}.`,
  ];
  for (const item of evidence) { ctx.fillStyle = coral; ctx.fillRect(80, y - 17, 10, 10); ctx.fillStyle = ink; y += wrap(ctx, item, 112, y, 1390, 39, 2) + 20; }
  if (alertsStatus === "ready" && alerts.length) {
    ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("NWS ALERTS AT WATCH LOCATION", 80, y + 27);
    ctx.fillStyle = ink; ctx.font = "26px system-ui";
    wrap(ctx, alerts.map((item) => item.event).join("  •  "), 80, y + 72, 1400, 36, 2);
  } else if (alertsStatus !== "ready") {
    ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("NWS ALERT CHECK UNAVAILABLE — VERIFY OFFICIAL SOURCES", 80, y + 27);
  } else {
    ctx.fillStyle = muted; ctx.font = "700 21px system-ui"; ctx.fillText("NO ACTIVE NWS ALERT RETURNED AT THIS CHECK — KEEP MONITORING", 80, y + 27);
  }
  ctx.fillStyle = coral; ctx.font = "700 26px system-ui"; ctx.fillText("EXPERIMENTAL — NOT AN OFFICIAL FORECAST", 80, 2090);
  ctx.fillStyle = muted; ctx.font = "24px system-ui";
  wrap(ctx, data.disclosure, 80, 2135, 1430, 34, 2);
  ctx.fillText("Official source: nhc.noaa.gov  •  Weather alerts: weather.gov", 80, 2230);
  ctx.fillText("hurricane.codeblackwx.com", 80, 2270);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image generation failed")), "image/png"));
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `codeblack-aegis-hurricane-${data.storm.name?.toLowerCase() ?? "watch"}.png`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
