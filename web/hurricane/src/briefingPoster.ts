import QRCode from "qrcode";
import type { PublicHurricane } from "./types";
import { displayTime } from "./types";
import type { PointAlert, WatchLocation } from "./watchLocation";
import { watchSummary } from "./watchLocation";
import type { LocalForecast } from "./LocalOverview";
import { localNarrative } from "./LocalOverview";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { compassDirection, estimateNorthernGulfLandfall, reviewedLandfall } from "./stormTelemetry";
import { hurricaneCategory } from "../../shared/hurricaneCategory";

export type ExportFormat = "portrait" | "landscape";
const palette = { black: "#06090c", panel: "#0c1318", panelAlt: "#101a20", line: "#28404b", red: "#ef4035", cyan: "#72d1ce", white: "#f3f5f7", muted: "#a9b8c4", dim: "#71838f" };

function label(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color = palette.muted, size = 19) {
  ctx.fillStyle = color; ctx.font = `700 ${size}px "Barlow Condensed", Inter, system-ui`; ctx.fillText(value.toUpperCase(), x, y);
}
function words(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, maxLines: number, color = palette.white, weight = 500) {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px Inter, system-ui`;
  const tokens = value.trim().split(/\s+/); let row = "", line = 0;
  for (const token of tokens) {
    const candidate = row ? `${row} ${token}` : token;
    if (ctx.measureText(candidate).width > width && row) {
      ctx.fillText(line === maxLines - 1 ? `${row}…` : row, x, y + line * size * 1.43);
      if (line === maxLines - 1) return size * 1.43 * maxLines;
      line++; row = token;
    } else row = candidate;
  }
  if (row && line < maxLines) ctx.fillText(row, x, y + line * size * 1.43);
  return (line + 1) * size * 1.43;
}
function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = palette.panel) {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ctx.strokeStyle = palette.line; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
}
async function loadImage(src: string) { const image = new Image(); image.src = src; await image.decode(); return image; }
function alertActive(alerts: PointAlert[], expression: RegExp) { return alerts.some((alert) => expression.test(alert.event)); }
function trend(delta: number | null | undefined, unit: string) { return delta == null ? "—" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${Math.abs(delta)} ${unit}`; }

export async function saveBriefingImage(data: PublicHurricane, mapPng: string | null, watch: WatchLocation, alerts: PointAlert[], alertsStatus: string, local: LocalForecast, format: ExportFormat = "portrait") {
  await document.fonts.ready;
  const landscape = format === "landscape", W = landscape ? 1920 : 1200, H = landscape ? 1260 : 2220;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Canvas unavailable");
  ctx.fillStyle = palette.black; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#102029"; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const pad = landscape ? 46 : 48, inner = W - pad * 2;
  ctx.fillStyle = palette.red; ctx.fillRect(pad, 38, landscape ? 92 : 76, 6);
  const shield = await loadImage(codeblackShield); ctx.drawImage(shield, pad, 60, 36, 56);
  ctx.fillStyle = palette.white; ctx.font = `700 29px "Barlow Condensed", Inter, system-ui`; ctx.fillText("CODE BLACK / TROPICS", pad + 54, 98);
  label(ctx, "LIVE TROPICAL BRIEFING", pad + 54, 126, palette.dim, 16);

  const category = hurricaneCategory(data.storm.max_wind_mph, data.storm.classification);
  const categoryText = category ? `CATEGORY ${category}` : data.storm.classification === "TS" ? "TROPICAL STORM" : "TROPICAL CYCLONE";
  const nameY = landscape ? 200 : 212;
  ctx.fillStyle = palette.white; ctx.font = `700 ${landscape ? 73 : 76}px "Barlow Condensed", Inter, system-ui`; ctx.fillText((data.storm.name ?? "Storm").toUpperCase(), pad, nameY);
  block(ctx, landscape ? 1374 : pad, landscape ? 145 : 242, landscape ? 500 : inner, 82, "#0b1015");
  label(ctx, "NHC", landscape ? 1400 : pad + 20, landscape ? 177 : 274, palette.red, 18);
  ctx.fillStyle = palette.white; ctx.font = `700 ${landscape ? 37 : 34}px "Barlow Condensed", Inter, system-ui`; ctx.fillText(categoryText, landscape ? 1400 : pad + 20, landscape ? 213 : 309);
  const issueY = landscape ? 257 : 352;
  label(ctx, `NHC ${displayTime(data.storm.last_update)}`, pad, issueY, palette.muted, 18);
  label(ctx, `SOURCES ${displayTime(data.checked_at)}`, pad, issueY + 29, palette.dim, 15);

  const metricY = landscape ? 315 : 405, metricH = 132, metricW = inner / 4;
  const proximity = watchSummary(data, watch);
  const metrics = [
    ["SUSTAINED WIND", data.storm.max_wind_mph == null ? "—" : `${data.storm.max_wind_mph} mph`, trend(data.observed.trend.wind_change_mph, "mph")],
    ["MINIMUM PRESSURE", data.storm.pressure_mb == null ? "—" : `${data.storm.pressure_mb} mb`, trend(data.observed.trend.pressure_change_mb, "mb")],
    ["MOVEMENT", `${compassDirection(data.storm.movement_degrees) ?? "—"} · ${data.storm.movement_mph ?? "—"} mph`, data.storm.movement_degrees == null ? "Bearing unavailable" : `${data.storm.movement_degrees}° from north`],
    [`CENTER TO ${watch.label}`, proximity.currentMiles == null ? "—" : `${proximity.currentMiles} mi`, proximity.centerBearing ? `${proximity.centerBearing.direction} · ${proximity.centerBearing.degrees}° bearing` : "Bearing unavailable"],
  ];
  metrics.forEach(([heading, value, detail], index) => {
    block(ctx, pad + index * metricW, metricY, metricW - 2, metricH, index === 0 ? "#11191f" : palette.panel);
    label(ctx, heading, pad + index * metricW + 17, metricY + 30, palette.muted, 14);
    ctx.fillStyle = palette.white; ctx.font = `700 ${landscape ? 34 : 31}px "Barlow Condensed", Inter, system-ui`; ctx.fillText(value, pad + index * metricW + 17, metricY + 74);
    label(ctx, detail, pad + index * metricW + 17, metricY + 109, index < 2 ? palette.red : palette.dim, 13);
  });

  const estimate = reviewedLandfall(data) ?? estimateNorthernGulfLandfall(data, "aegis") ?? estimateNorthernGulfLandfall(data, "nhc");
  const confirmed = data.official.landfall?.status === "confirmed" ? data.official.landfall : null;
  const landfallY = metricY + metricH + 24;
  block(ctx, pad, landfallY, inner, landscape ? 128 : 184, "#10171d"); ctx.fillStyle = palette.red; ctx.fillRect(pad, landfallY, 6, landscape ? 128 : 184);
  label(ctx, confirmed ? "NHC confirmed landfall" : "Landfall estimate", pad + 24, landfallY + 34, palette.red, 20);
  const destination = confirmed ? `Near ${confirmed.location}` : estimate ? `Near ${estimate.nearestCity ?? estimate.region}` : "Estimate unavailable";
  ctx.fillStyle = palette.white; ctx.font = `700 ${landscape ? 42 : 46}px "Barlow Condensed", Inter, system-ui`; ctx.fillText(destination.toUpperCase(), pad + 24, landfallY + 82);
  const estimateTime = confirmed ? displayTime(confirmed.at) : estimate ? displayTime(estimate.centerTime) : "Awaiting guidance";
  label(ctx, `${confirmed ? "CONFIRMED" : "ESTIMATED"} ${estimateTime}`, pad + 24, landfallY + 116, palette.muted, 16);
  if (!confirmed && estimate?.windowStart && estimate.windowEnd) label(ctx, `WINDOW ${displayTime(estimate.windowStart)} – ${displayTime(estimate.windowEnd)}`, pad + 24, landfallY + 151, palette.dim, 14);
  if (confirmed || estimate) {
    const minutes = confirmed ? Math.max(0, Math.floor((Date.now() - Date.parse(confirmed.at)) / 60_000)) : Math.max(0, Math.ceil((Date.parse(estimate!.centerTime) - Date.now()) / 60_000));
    const countdown = `${Math.floor(minutes / 1440)}D ${Math.floor(minutes % 1440 / 60)}H ${minutes % 60}M`;
    const right = landscape ? W - 360 : pad + 24;
    if (landscape) { label(ctx, confirmed ? "SINCE LANDFALL" : "COUNTDOWN", right, landfallY + 42, palette.cyan, 18); ctx.fillStyle = palette.white; ctx.font = `700 47px "Barlow Condensed", Inter, system-ui`; ctx.fillText(countdown, right, landfallY + 91); }
    else { label(ctx, confirmed ? "SINCE LANDFALL" : "COUNTDOWN", right, landfallY + 158, palette.cyan, 15); ctx.fillStyle = palette.white; ctx.font = `700 32px "Barlow Condensed", Inter, system-ui`; ctx.fillText(countdown, right + 166, landfallY + 162); }
  }

  const mapY = landfallY + (landscape ? 152 : 208), mapH = landscape ? 446 : 574;
  block(ctx, pad, mapY, inner, mapH, "#0a1116");
  if (mapPng) {
    const map = await loadImage(mapPng); const scale = Math.max(inner / map.width, mapH / map.height); const drawW = map.width * scale, drawH = map.height * scale;
    ctx.save(); ctx.beginPath(); ctx.rect(pad + 2, mapY + 2, inner - 4, mapH - 4); ctx.clip(); ctx.drawImage(map, pad + (inner - drawW) / 2, mapY + (mapH - drawH) / 2, drawW, drawH); ctx.restore();
    ctx.fillStyle = "rgba(6,9,12,.62)"; ctx.fillRect(pad + 18, mapY + 18, landscape ? 355 : 390, 62);
    label(ctx, "LIVE STORM POSITION + PROJECTED PATH", pad + 32, mapY + 45, palette.white, 15);
    label(ctx, "NHC OFFICIAL · CODE BLACK EXPERIMENTAL", pad + 32, mapY + 68, palette.cyan, 12);
  } else { ctx.fillStyle = palette.dim; ctx.font = "500 26px Inter, system-ui"; ctx.fillText("Map capture unavailable — open tropics.codeblackwx.com for live map", pad + 32, mapY + mapH / 2); }
  ctx.fillStyle = palette.red; ctx.fillRect(pad, mapY, 5, mapH);

  const impactY = mapY + mapH + 24, impactH = landscape ? 126 : 192;
  block(ctx, pad, impactY, inner, impactH, "#0e161b"); label(ctx, `LOCAL HAZARDS · ${watch.label}`, pad + 20, impactY + 32, palette.red, 17);
  const impacts: [string, RegExp][] = [["WIND", /Hurricane Warning|Tropical Storm Warning/i], ["FLOOD", /Flood Warning|Flood Watch/i], ["SURGE", /Storm Surge Warning|High Surf Warning/i], ["TORNADO", /Tornado Warning|Tornado Watch/i]];
  impacts.forEach(([name, test], index) => {
    const x = pad + index * inner / 4 + 20, active = alertActive(alerts, test);
    label(ctx, name, x, impactY + 72, palette.muted, 15); ctx.fillStyle = active ? palette.red : palette.dim; ctx.fillRect(x, impactY + 87, landscape ? 180 : 195, 9); label(ctx, active ? "ACTIVE" : "MONITORING", x, impactY + 120, active ? palette.red : palette.dim, 14);
  });

  const briefingY = impactY + impactH + 30, briefingH = landscape ? 205 : 395;
  const reviewCutoff = confirmed?.observed_at ?? confirmed?.at;
  const reviewed = (data.ai?.status === "ready" || data.ai?.status === "stale") && (!confirmed || Boolean(reviewCutoff && data.ai?.reviewed_at && data.ai?.analyzed_at && Date.parse(data.ai.reviewed_at) >= Date.parse(reviewCutoff) && Date.parse(data.ai.analyzed_at) >= Date.parse(reviewCutoff)));
  block(ctx, pad, briefingY, inner, briefingH, "#0c1419"); label(ctx, reviewed ? "Aegis analysis" : "Aegis review pending", pad + 22, briefingY + 34, palette.cyan, 20);
  const summary = reviewed && data.ai?.summary ? data.ai.summary : "Aegis review is pending. Use the latest official NHC forecast and local NWS alerts.";
  const textWidth = landscape ? inner * .62 : inner - 44;
  words(ctx, summary, pad + 22, briefingY + 72, textWidth, landscape ? 23 : 27, landscape ? 3 : 4, palette.white);
  const nextHour = reviewed && data.ai?.next_hour_outlook ? data.ai.next_hour_outlook : localNarrative(watch, alerts, alertsStatus, local);
  if (landscape) {
    ctx.strokeStyle = palette.line; ctx.beginPath(); ctx.moveTo(pad + inner * .66, briefingY + 20); ctx.lineTo(pad + inner * .66, briefingY + briefingH - 20); ctx.stroke();
    label(ctx, "NEXT HOUR", pad + inner * .69, briefingY + 45, palette.cyan, 17); words(ctx, nextHour, pad + inner * .69, briefingY + 79, inner * .28, 21, 3, palette.muted);
  } else { label(ctx, "NEXT HOUR", pad + 22, briefingY + 255, palette.cyan, 17); words(ctx, nextHour, pad + 22, briefingY + 286, inner - 44, 22, 2, palette.muted); }
  label(ctx, reviewed ? `REVIEW ${displayTime(data.ai?.reviewed_at)} · ${data.ai?.review_model ?? "LOCAL ANALYSIS"}` : "AWAITING POST-LANDFALL ANALYSIS", pad + 22, briefingY + briefingH - 22, palette.dim, 13);

  const footerY = H - 164;
  ctx.fillStyle = palette.red; ctx.fillRect(pad, footerY, inner, 3); label(ctx, "CODE BLACK / TROPICS", pad, footerY + 40, palette.white, 19); label(ctx, "EXPERIMENTAL ANALYSIS · FOLLOW NHC AND NWS GUIDANCE", pad, footerY + 72, palette.red, 15); label(ctx, `SNAPSHOT ${displayTime(data.checked_at)}`, pad, footerY + 105, palette.muted, 14);
  const qr = await loadImage(await QRCode.toDataURL("https://tropics.codeblackwx.com/", { margin: 1, width: 160, color: { dark: palette.white, light: palette.black } })); ctx.drawImage(qr, W - pad - 120, footerY + 22, 112, 112); label(ctx, "SCAN FOR LIVE VIEW", W - pad - 352, footerY + 92, palette.cyan, 15);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("Export failed")), "image/png"));
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `codeblack-tropics-${format}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
