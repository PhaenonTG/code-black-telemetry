import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import { watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { hurricaneCategory } from "../../shared/hurricaneCategory";
import { compassDirection, currentAdvisoryTrend, estimateNorthernGulfLandfall } from "./stormTelemetry";

const W = 1600, H = 2550;
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
  ctx.fillStyle = ink; ctx.font = "800 30px system-ui"; ctx.fillText("CODE BLACK  /  TROPICS", 142, 87);
  ctx.fillStyle = muted; ctx.font = "700 16px system-ui"; ctx.fillText("TROPICS", 144, 115);
  ctx.fillStyle = ink; ctx.font = "800 62px system-ui"; ctx.fillText(`TROPICS  /  ${data.storm.classification === "HU" ? "HURRICANE" : "STORM"} ${data.storm.name?.toUpperCase() ?? "WATCH"}`, 80, 225);
  ctx.fillStyle = muted; ctx.font = "28px system-ui"; ctx.fillText(`Updated ${displayTime(data.checked_at)}  •  NHC ${displayTime(data.storm.last_update)}`, 80, 277);
  ctx.fillStyle = "#111216"; ctx.fillRect(80, 318, 1440, 138);
  const category = hurricaneCategory(data.storm.max_wind_mph, data.storm.classification);
  const trend = currentAdvisoryTrend(data, watch);
  const metrics = [
    [category === null ? "MAX WIND · NHC" : `MAX WIND · NHC CATEGORY ${category}`, data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`, trend.wind == null ? "" : `${trend.wind > 0 ? "↑ +" : trend.wind < 0 ? "↓ " : "→ "}${trend.wind} mph / ${trend.elapsedHours}h`, trend.wind != null && trend.wind > 0],
    ["MINIMUM PRESSURE", data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`, trend.pressure == null ? "" : `${trend.pressure > 0 ? "↑ +" : trend.pressure < 0 ? "↓ " : "→ "}${trend.pressure} mb / ${trend.elapsedHours}h`, trend.pressure != null && trend.pressure < 0],
    ["MOVEMENT · NHC", data.storm.movement_mph == null ? "—" : `${compassDirection(data.storm.movement_degrees) ?? "—"} · ${data.storm.movement_mph} mph`, data.storm.movement_degrees == null ? "" : `${data.storm.movement_degrees}° from north`, false],
  ];
  metrics.forEach(([label, value, detail, adverse], i) => { const x = 110 + i * 470; ctx.fillStyle = muted; ctx.font = "700 20px system-ui"; ctx.fillText(String(label), x, 356); ctx.fillStyle = ink; ctx.font = "700 36px system-ui"; ctx.fillText(String(value), x, 402); ctx.fillStyle = i === 2 ? muted : adverse ? "#ff806f" : detail ? "#71d3a1" : muted; ctx.font = "700 19px system-ui"; ctx.fillText(String(detail), x, 435); });
  const gulfTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" }).format(new Date(value));
  const aegisLandfall = estimateNorthernGulfLandfall(data, "aegis"), nhcLandfall = estimateNorthernGulfLandfall(data, "nhc");
  if (aegisLandfall) {
    ctx.fillStyle = coral; ctx.font = "800 21px system-ui";
    ctx.fillText(`AEGIS COAST CROSSING · ~${gulfTime(aegisLandfall.centerTime)} · ${aegisLandfall.region} · EXPERIMENTAL`, 80, 482, 1430);
    if (nhcLandfall) { ctx.fillStyle = muted; ctx.font = "700 18px system-ui"; ctx.fillText(`NHC centerline comparison · ~${gulfTime(nhcLandfall.centerTime)} · ${nhcLandfall.region}`, 80, 508, 1430); }
  }
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("Aegis model synthesis", 80, 550);
  ctx.fillStyle = muted; ctx.font = "25px system-ui"; ctx.fillText("Experimental center-track blend  /  Official NHC forecast shown separately", 80, 585);
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(80, 610, 1440, 800);
  if (mapPng) { const image = new Image(); image.src = mapPng; await image.decode(); ctx.drawImage(image, 80, 610, 1440, 800); }
  else { ctx.fillStyle = muted; ctx.font = "30px system-ui"; ctx.fillText("Map image unavailable — consult the live briefing for tracks.", 140, 1000); }
  ctx.fillStyle = "#02080edb"; ctx.fillRect(104, 632, 558, 69);
  ctx.fillStyle = ink; ctx.font = "800 26px system-ui"; ctx.fillText("GULF TRACK OVERVIEW", 124, 674);
  ctx.fillStyle = cyan; ctx.fillRect(104, 700, 160, 5);
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(80, 1326, 650, 84);
  ctx.fillStyle = cyan; ctx.font = "700 21px system-ui"; ctx.fillText("━━  AEGIS EXPERIMENTAL", 104, 1378);
  ctx.fillStyle = "#0d0e11"; ctx.fillRect(750, 1326, 770, 84);
  ctx.fillStyle = ink; ctx.fillText("┄┄  NHC OFFICIAL FORECAST", 775, 1378);
  ctx.fillStyle = ink; ctx.font = "700 30px system-ui"; ctx.fillText("Model guidance · +24 hours", 80, 1465);
  ctx.fillStyle = muted; ctx.font = "20px system-ui"; ctx.fillText("Each aid's own cycle · peak storm wind, not wind at the watch location", 80, 1500);
  for (const [index, id] of ["HFAI", "HFBI", "AVNI"].entries()) {
    const model = data.guidance.models.find((item) => item.id === id), point = model?.points.find((item) => item.hour === 24);
    const x = 80 + index * 490;
    ctx.fillStyle = "#11161a"; ctx.fillRect(x, 1521, 470, 112);
    ctx.fillStyle = cyan; ctx.font = "700 21px system-ui"; ctx.fillText(model?.name ?? id, x + 18, 1555);
    ctx.fillStyle = ink; ctx.font = "700 29px system-ui"; ctx.fillText(point?.wind_mph == null ? "Wind unavailable" : `${point.wind_mph} mph`, x + 18, 1600);
    ctx.fillStyle = muted; ctx.font = "17px system-ui"; ctx.fillText(`Cycle ${displayTime(model?.cycle)}`, x + 180, 1555);
  }
  const proximity = watchSummary(data, watch);
  ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("WATCH LOCATION", 80, 1685);
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; wrap(ctx, watch.label, 80, 1733, 1430, 42, 2);
  ctx.fillStyle = muted; ctx.font = "25px system-ui";
  ctx.fillText(`Current center: ${proximity.currentMiles == null ? "unavailable" : `${proximity.currentMiles} mi away`}   •   Closest NHC center: ${proximity.official ? `${proximity.official.miles} mi at +${proximity.official.point.hour}h` : "unavailable"}`, 80, 1815);
  ctx.fillText(`Closest Aegis blended center: ${proximity.aegis ? `${proximity.aegis.miles} mi at +${proximity.aegis.point.hour}h` : "unavailable"}   •   Center distance does not predict local impacts.`, 80, 1857);
  ctx.fillStyle = ink; ctx.font = "700 32px system-ui"; ctx.fillText("Aegis analysis", 80, 1925);
  ctx.fillStyle = muted; ctx.font = "26px system-ui";
  let y = 1979;
  const aiSummary = data.ai?.status === "ready" && data.ai.summary
    ? data.ai.summary : "Aegis interpretation unavailable. Use the official NHC forecast and NWS warnings.";
  ctx.fillStyle = ink; y += wrap(ctx, aiSummary, 80, y, 1420, 39, 4);
  ctx.fillStyle = muted; ctx.font = "20px system-ui";
  ctx.fillText(`Aegis analyzed ${displayTime(data.ai?.analyzed_at)}  •  Sources checked ${displayTime(data.checked_at)}`, 80, y + 8);
  y += 24;
  if (alertsStatus === "ready" && alerts.length) {
    ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("NWS ALERTS AT WATCH LOCATION", 80, y + 20);
    ctx.fillStyle = ink; ctx.font = "26px system-ui";
    wrap(ctx, alerts.map((item) => item.event).join("  •  "), 80, y + 58, 1400, 36, 2);
  } else if (alertsStatus !== "ready") {
    ctx.fillStyle = coral; ctx.font = "700 21px system-ui"; ctx.fillText("NWS ALERT CHECK UNAVAILABLE — VERIFY OFFICIAL SOURCES", 80, y + 20);
  } else {
    ctx.fillStyle = muted; ctx.font = "700 21px system-ui"; ctx.fillText("NO ACTIVE NWS ALERT RETURNED AT THIS CHECK — KEEP MONITORING", 80, y + 20);
  }
  ctx.fillStyle = coral; ctx.font = "700 26px system-ui"; ctx.fillText("EXPERIMENTAL — NOT AN OFFICIAL FORECAST", 80, 2340);
  ctx.fillStyle = muted; ctx.font = "24px system-ui";
  wrap(ctx, data.disclosure, 80, 2385, 1430, 34, 2);
  ctx.fillText("Official source: nhc.noaa.gov  •  Weather alerts: weather.gov", 80, 2480);
  ctx.fillText("tropics.codeblackwx.com", 80, 2520);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image generation failed")), "image/png"));
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `codeblack-tropics-${data.storm.name?.toLowerCase() ?? "watch"}.png`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
