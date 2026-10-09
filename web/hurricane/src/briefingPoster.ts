import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import { watchSummary } from "./watchLocation";
import type { PointAlert, WatchLocation } from "./watchLocation";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { hurricaneCategory } from "../../shared/hurricaneCategory";
import { compassDirection, currentAdvisoryTrend, estimateNorthernGulfLandfall, reviewedLandfall } from "./stormTelemetry";

const W = 1600;
const black = "#050608", surface = "#11151a", white = "#f5f6f8", quiet = "#aeb7c2";
const border = "#3d454e", red = "#ee3429", cyan = "#45d9d1";
const localTime = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short",
}).format(new Date(value));

function label(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color = quiet) {
  ctx.fillStyle = color; ctx.font = "800 19px Inter, system-ui"; ctx.fillText(value, x, y);
}
function type(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, font: string, color = white, maxWidth?: number) {
  ctx.fillStyle = color; ctx.font = font; ctx.fillText(value, x, y, maxWidth);
}
function bar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, color = border, height = 1) {
  ctx.fillStyle = color; ctx.fillRect(x, y, width, height);
}
function wrap(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, step: number, maxLines: number) {
  let current = "", lines = 0;
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= width || !current) { current = next; continue; }
    if (lines + 1 >= maxLines) {
      let truncated = current;
      while (truncated && ctx.measureText(`${truncated}…`).width > width) truncated = truncated.slice(0, -1);
      ctx.fillText(`${truncated}…`, x, y + lines * step);
      return maxLines * step;
    }
    ctx.fillText(current, x, y + lines * step);
    lines++;
    current = word;
  }
  if (current && lines < maxLines) { ctx.fillText(current, x, y + lines * step); lines++; }
  return lines * step;
}
function stat(ctx: CanvasRenderingContext2D, x: number, heading: string, value: string, trend: string, adverse: boolean) {
  label(ctx, heading, x, 365);
  type(ctx, value, x, 433, "800 53px 'Barlow Condensed', system-ui", white, 430);
  type(ctx, trend, x, 468, "800 21px Inter, system-ui", adverse ? red : "#8cdec1", 430);
}

export async function saveBriefingImage(data: PublicHurricane, mapPng: string | null, watch: WatchLocation, alerts: PointAlert[], alertsStatus: string) {
  await Promise.all([document.fonts.load("800 82px 'Barlow Condensed'"), document.fonts.load("700 22px Inter"), document.fonts.load("500 20px Inter")]);
  const aiSummary = (data.ai?.status === "ready" || data.ai?.status === "stale") && data.ai.summary
    ? data.ai.summary : "Aegis interpretation unavailable. Use the official NHC forecast and NWS warnings.";
  const alertText = alertsStatus !== "ready" ? "Alert check unavailable — verify directly with NWS."
    : alerts.length ? [...new Set(alerts.map((item) => item.event))].join("  ·  ") : "No active NWS alerts returned at this check.";
  const measure = document.createElement("canvas").getContext("2d"); if (!measure) throw new Error("Canvas is unavailable");
  measure.font = "500 20px Inter, system-ui";
  const measuredSummaryHeight = wrap(measure, aiSummary, 0, 0, 1472, 31, 20);
  measure.font = "500 21px Inter, system-ui";
  const measuredAlertHeight = wrap(measure, alertText, 0, 0, 1472, 34, 6);
  const analysisFootY = 1713 + measuredSummaryHeight + 18;
  const alertsTitleY = analysisFootY + 67, alertsBodyY = alertsTitleY + 58;
  const footerY = alertsBodyY + measuredAlertHeight + 64, H = footerY + 240;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas is unavailable");
  ctx.fillStyle = black; ctx.fillRect(0, 0, W, H);

  // Identity masthead
  bar(ctx, 64, 38, 78, red, 8);
  const shield = new Image(); shield.src = codeblackShield; await shield.decode(); ctx.drawImage(shield, 64, 56, 54, 86);
  type(ctx, "CODE BLACK", 136, 103, "800 45px 'Barlow Condensed', system-ui");
  type(ctx, "T R O P I C S", 139, 133, "700 18px Inter, system-ui", quiet);
  type(ctx, "HURRICANE BRIEFING", 1290, 94, "800 17px Inter, system-ui", quiet);
  bar(ctx, 1408, 115, 128, red, 4);
  const prefix = "TROPICS  /  ";
  type(ctx, prefix, 64, 248, "800 80px 'Barlow Condensed', system-ui");
  type(ctx, `${data.storm.classification === "HU" ? "HURRICANE" : "STORM"} ${data.storm.name?.toUpperCase() ?? "WATCH"}`,
    64 + ctx.measureText(prefix).width, 248, "800 80px 'Barlow Condensed', system-ui", red, 1460 - ctx.measureText(prefix).width);
  type(ctx, `Updated ${displayTime(data.checked_at)}  •  NHC ${displayTime(data.storm.last_update)}`,
    64, 293, "500 24px Inter, system-ui", quiet);

  // Current NHC data
  ctx.fillStyle = surface; ctx.fillRect(64, 325, 1472, 170); bar(ctx, 64, 325, 5, red, 170);
  bar(ctx, 552, 343, 1, border, 134); bar(ctx, 1041, 343, 1, border, 134);
  const category = hurricaneCategory(data.storm.max_wind_mph, data.storm.classification);
  const trend = currentAdvisoryTrend(data, watch);
  stat(ctx, 94, category == null ? "MAXIMUM SUSTAINED WIND" : `MAX WIND · NHC CATEGORY ${category}`,
    data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`,
    trend.wind == null ? "Prior value unavailable" : `${trend.wind > 0 ? "↑ +" : trend.wind < 0 ? "↓ " : "→ "}${trend.wind} mph / ${trend.elapsedHours}h`,
    trend.wind != null && trend.wind > 0);
  stat(ctx, 582, "MINIMUM PRESSURE", data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`,
    trend.pressure == null ? "Prior value unavailable" : `${trend.pressure > 0 ? "↑ +" : trend.pressure < 0 ? "↓ " : "→ "}${trend.pressure} mb / ${trend.elapsedHours}h`,
    trend.pressure != null && trend.pressure < 0);
  stat(ctx, 1072, "MOVEMENT · NHC",
    data.storm.movement_mph == null ? "—" : `${compassDirection(data.storm.movement_degrees) ?? "—"} · ${data.storm.movement_mph} mph`,
    data.storm.movement_degrees == null ? "Direction unavailable" : `${data.storm.movement_degrees}° from north`, false);

  // Comparable centerline estimates, with their distinct issuance times
  const reviewed = reviewedLandfall(data);
  const modelBlend = estimateNorthernGulfLandfall(data, "aegis");
  const blend = reviewed ?? modelBlend;
  const nhc = estimateNorthernGulfLandfall(data, "nhc");
  const selectedNhc = Boolean(reviewed && data.ai?.landfall?.source === "NHC");
  const comparison = selectedNhc ? modelBlend : nhc;
  label(ctx, reviewed ? "AEGIS REVIEWED · EXPERIMENTAL" : blend ? "CODE BLACK EXPERIMENTAL" : "CENTERLINE ESTIMATE", 64, 540, red);
  type(ctx, blend ? `~${localTime(blend.centerTime)} · ${blend.nearestCity ? `near ${blend.nearestCity}` : blend.region}` : "Unavailable",
    64, 581, "800 37px 'Barlow Condensed', system-ui", white, 696);
  type(ctx, reviewed ? `Aegis reviewed ${displayTime(data.ai?.reviewed_at)} · selected ${data.ai?.landfall?.source}` : blend && data.projection.cycle ? `Model cycle ${localTime(data.projection.cycle)}` : "Experimental track unavailable",
    64, 611, "500 18px Inter, system-ui", quiet);
  bar(ctx, 799, 520, 1, border, 109);
  label(ctx, selectedNhc ? "MODEL-BLEND COMPARISON" : "NHC OFFICIAL CENTERLINE", 829, 540);
  type(ctx, comparison ? `~${localTime(comparison.centerTime)} · ${comparison.region}` : "Unavailable",
    829, 581, "800 37px 'Barlow Condensed', system-ui", white, 707);
  type(ctx, selectedNhc ? `Model cycle ${displayTime(data.projection.cycle)}` : `Forecast issued ${displayTime(data.official.issued_at)}`,
    829, 611, "500 18px Inter, system-ui", quiet);
  bar(ctx, 64, 639, 1472, red, 3);

  // Supporting map; the live track map supplies the pixels at export time.
  const mapY = 659, mapH = 670;
  ctx.fillStyle = surface; ctx.fillRect(64, mapY, 1472, mapH);
  if (mapPng) {
    const map = new Image(); map.src = mapPng; await map.decode();
    ctx.drawImage(map, 64, mapY, 1472, mapH);
  } else {
    type(ctx, "Map image unavailable — use the live Tropics track map.", 125, 1000, "600 27px Inter, system-ui", quiet);
  }
  ctx.fillStyle = "#050608ee"; ctx.fillRect(64, mapY, 1472, 76);
  type(ctx, "GULF TRACK OVERVIEW", 90, mapY + 50, "800 37px 'Barlow Condensed', system-ui");
  bar(ctx, 877, mapY + 39, 24, red, 3); type(ctx, "CODE BLACK EXPERIMENTAL", 913, mapY + 47, "800 16px Inter, system-ui", red);
  bar(ctx, 1235, mapY + 39, 24, white, 3); type(ctx, "NHC OFFICIAL", 1271, mapY + 47, "800 16px Inter, system-ui", white);
  ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.strokeRect(64, mapY, 1472, mapH);

  // Evidence and local watch in paired columns
  const left = 64, right = 818, rightWidth = 718;
  type(ctx, "MODEL GUIDANCE · +24 HOURS", left, 1394, "800 37px 'Barlow Condensed', system-ui");
  type(ctx, "Each aid’s own cycle · peak storm wind, not wind at this location", left, 1428, "500 16px Inter, system-ui", quiet);
  ["HFAI", "HFBI", "AVNI"].forEach((id, index) => {
    const model = data.guidance.models.find((item) => item.id === id);
    const point = model?.points.find((item) => item.hour === 24);
    const x = left + index * 241;
    ctx.fillStyle = surface; ctx.fillRect(x, 1451, 228, 139); bar(ctx, x, 1451, 228);
    type(ctx, model?.name ?? id, x + 15, 1488, "800 20px Inter, system-ui", cyan, 197);
    type(ctx, point?.wind_mph == null ? "Unavailable" : `${point.wind_mph} mph`,
      x + 15, 1537, "800 37px 'Barlow Condensed', system-ui", white, 197);
    type(ctx, `Cycle ${displayTime(model?.cycle)}`, x + 15, 1570, "500 15px Inter, system-ui", quiet, 197);
  });
  bar(ctx, 790, 1360, 1, border, 252);
  type(ctx, "WATCH LOCATION", right, 1394, "800 37px 'Barlow Condensed', system-ui");
  bar(ctx, 1107, 1386, 429, red, 3);
  ctx.fillStyle = white; ctx.font = "800 38px 'Barlow Condensed', system-ui";
  const locationLines = wrap(ctx, watch.label, right, 1452, rightWidth, 43, 2);
  const shift = Math.max(0, locationLines - 43);
  const proximity = watchSummary(data, watch);
  const distances = [
    `Current center: ${proximity.currentMiles == null ? "unavailable" : `${proximity.currentMiles} mi away`}`,
    `Gulf radar: ${data.monitoring.radar_analysis === "ready" ? "MRMS current" : data.monitoring.radar_analysis === "partial" ? "partial" : "unavailable"}`,
  ];
  distances.forEach((value, index) => type(ctx, value, right, 1500 + shift + index * 32, "600 20px Inter, system-ui", quiet, rightWidth));

  type(ctx, "AEGIS ANALYSIS", left, 1653, "800 37px 'Barlow Condensed', system-ui"); bar(ctx, left, 1666, 83, red, 3);
  ctx.fillStyle = white; ctx.font = "500 20px Inter, system-ui";
  wrap(ctx, aiSummary, left, 1713, 1472, 31, 20);
  type(ctx, `${data.ai?.analyzed_at ? `${data.ai.status === "stale" ? "Earlier review" : "Aegis analyzed"} ${displayTime(data.ai.analyzed_at)} · ` : ""}Sources ${displayTime(data.checked_at)}`,
    left, analysisFootY, "500 16px Inter, system-ui", quiet, 1472);
  type(ctx, "NWS ALERTS AT WATCH LOCATION", left, alertsTitleY, "800 34px 'Barlow Condensed', system-ui");
  bar(ctx, left, alertsTitleY + 13, 83, red, 3);
  ctx.fillStyle = white; ctx.font = "500 21px Inter, system-ui";
  wrap(ctx, alertText, left, alertsBodyY, 1472, 34, 6);

  // Compact provenance footer, never mistaken for an official bulletin
  bar(ctx, 64, footerY, 1472, red, 3);
  type(ctx, "EXPERIMENTAL — NOT AN OFFICIAL FORECAST", 64, footerY + 46, "800 23px Inter, system-ui", red);
  ctx.fillStyle = quiet; ctx.font = "500 19px Inter, system-ui";
  wrap(ctx, data.disclosure, 64, footerY + 85, 1080, 30, 4);
  bar(ctx, 1206, footerY + 35, 1, border, 136);
  type(ctx, "Official: nhc.noaa.gov", 1234, footerY + 80, "600 18px Inter, system-ui", quiet);
  type(ctx, "Alerts: weather.gov", 1234, footerY + 116, "600 18px Inter, system-ui", quiet);
  type(ctx, "tropics.codeblackwx.com", 1234, footerY + 152, "700 18px Inter, system-ui", white);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image generation failed")), "image/png"));
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `codeblack-tropics-${data.storm.name?.toLowerCase() ?? "watch"}.png`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
