/** One-page, source-attributed hurricane briefing rendered from live OPS data. */
import { hurricaneCategory } from "../../../shared/hurricaneCategory";
export type BriefingImageData = {
  status: string;
  freshness?: string;
  checked_at?: string;
  storm?: { name: string; classification: string; pressure: string; lastUpdate: string; publicAdvisory?: { url: string } };
  assessment?: { advisory: string; intensity_mph: number; center_distance_miles: number; forecast_point_distance_miles: number | null; closest_forecast_hour: number | null; updated_at: string; summary: string; limitations: string };
  watch_point?: { label: string };
  alerts?: { event?: string; severity?: string; expires?: string; headline?: string }[];
  alerts_status?: string;
  coastal_context_alerts?: { event?: string }[];
  coastal_context_status?: string;
  alerts_checked_at?: string;
  rapid_alerts_status?: string;
  rapid_alerts_checked_at?: string;
  reports?: { issued: string; text: string }[];
  reports_status?: string;
  observed_trend?: { period_hours: number | null; wind_change_mph: number | null; pressure_change_mb: number | null };
  observed_track?: { valid_time: string; wind_mph: number | null }[];
  track?: { hour: number; wind_mph: number | null }[];
  model_guidance?: { status: string; latest_cycle?: string; comparison_valid_time?: string; spread_48h_miles?: number | null; wind_48h_mph_range?: number[] | null; models: { name: string; cycle: string; closest_center_miles: number; closest_hour: number; shift_48h_miles: number | null }[] };
  ai?: { status: string; summary?: string; supporting_factors?: string | string[]; limiting_factors?: string | string[]; recommended_attention?: string | string[] };
};

const W = 1600;
const H = 2200;
const C = { bg: "#08111b", surface: "#101d29", line: "#344757", white: "#f4f8fa", muted: "#a7b9c7", coral: "#ff7568", cyan: "#65ded7", gold: "#f5bd69", purple: "#bba4f7", blue: "#87b4ff" };

function printTime(value?: string): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function label(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color = C.muted) {
  ctx.fillStyle = color;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(value.toUpperCase(), x, y);
}

function value(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 46, color = C.white) {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  ctx.fillText(text, x, y);
}

function paragraph(ctx: CanvasRenderingContext2D, content: string, x: number, y: number,
                   maxWidth: number, lineHeight = 35, maxLines = 3, color = C.white): number {
  ctx.fillStyle = color;
  ctx.font = "400 27px Inter, system-ui, sans-serif";
  const words = content.replace(/\s+/g, " ").trim().split(" ");
  let line = "";
  let count = 0;
  for (const [index, word] of words.entries()) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) { line = candidate; continue; }
    ctx.fillText(line, x, y + count * lineHeight);
    count += 1;
    if (count >= maxLines - 1) { line = `${word} ${words.slice(index + 1).join(" ")}`; break; }
    line = word;
  }
  if (line && count < maxLines) {
    while (ctx.measureText(line).width > maxWidth && line.length > 1) line = `${line.slice(0, -2)}…`;
    ctx.fillText(line, x, y + count * lineHeight);
    count += 1;
  }
  return y + count * lineHeight;
}

function rule(ctx: CanvasRenderingContext2D, y: number, x = 72, width = W - 144) {
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = C.surface;
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 18); ctx.fill();
  ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
}

function sourceLine(ctx: CanvasRenderingContext2D, heading: string, detail: string, x: number, y: number) {
  label(ctx, heading, x, y);
  ctx.fillStyle = C.white; ctx.font = "600 26px Inter, system-ui, sans-serif";
  ctx.fillText(detail, x, y + 37);
}

function chart(ctx: CanvasRenderingContext2D, data: BriefingImageData, x: number, y: number, width: number, height: number) {
  const observed = (data.observed_track ?? []).filter((point) => point.wind_mph != null)
    .map((point) => ({ t: new Date(point.valid_time).getTime(), wind: point.wind_mph! }));
  const start = new Date(data.storm?.lastUpdate ?? data.checked_at ?? "").getTime();
  const forecast = (data.track ?? []).filter((point) => point.wind_mph != null)
    .map((point) => ({ t: start + point.hour * 3_600_000, wind: point.wind_mph! }));
  const all = [...observed, ...forecast].filter((point) => Number.isFinite(point.t));
  if (all.length < 2) { paragraph(ctx, "Trend chart unavailable for this assessment.", x, y + 40, width, 36, 2, C.muted); return; }
  const minT = Math.min(...all.map((point) => point.t));
  const maxT = Math.max(...all.map((point) => point.t));
  const minWind = Math.max(0, Math.floor(Math.min(...all.map((point) => point.wind)) / 20) * 20 - 20);
  const maxWind = Math.ceil(Math.max(...all.map((point) => point.wind)) / 20) * 20 + 20;
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  for (let step = 0; step <= 3; step++) {
    const yy = y + height - step * height / 3;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + width, yy); ctx.stroke();
  }
  const px = (t: number) => x + (t - minT) / Math.max(1, maxT - minT) * width;
  const py = (wind: number) => y + height - (wind - minWind) / Math.max(1, maxWind - minWind) * height;
  for (const [points, color, dashed] of [[observed, C.cyan, false], [forecast, C.coral, true]] as const) {
    if (points.length < 2) continue;
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.setLineDash(dashed ? [16, 12] : []);
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(px(point.t), py(point.wind)) : ctx.moveTo(px(point.t), py(point.wind))); ctx.stroke();
  }
  ctx.setLineDash([]);
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

function mapFallback(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = "#142432"; ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#2c4658"; ctx.lineWidth = 1;
  for (let i = 1; i < 7; i++) { ctx.beginPath(); ctx.moveTo(x + i * width / 7, y); ctx.lineTo(x + i * width / 7, y + height); ctx.stroke(); }
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * height / 4); ctx.lineTo(x + width, y + i * height / 4); ctx.stroke(); }
  value(ctx, "RADAR IMAGE UNAVAILABLE", x + 42, y + height / 2, 38);
  paragraph(ctx, "Use the official NHC forecast link below. This image does not contain live radar.", x + 42, y + height / 2 + 50, width - 84, 34, 2, C.muted);
}

export async function createHurricaneBriefingImage(data: BriefingImageData, mapDataUrl: string | null, radarStatus: string): Promise<Blob> {
  if (!data.storm || !data.assessment) throw new Error("The current hurricane assessment is not ready.");
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot render the briefing image.");
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.coral; ctx.fillRect(72, 55, 12, 55);
  label(ctx, "CODE BLACK OPS / HURRICANE WATCH", 108, 80, C.white);
  label(ctx, `GENERATED ${printTime(new Date().toISOString())}`, 108, 113, C.muted);
  label(ctx, data.status === "active" ? "ACTIVE WATCH" : "LAST PUBLISHED FORECAST", 1180, 80, C.cyan);
  value(ctx, data.storm.name.toUpperCase(), 72, 209, 96);
  value(ctx, "GRAND BAY WATCH", 76, 263, 34, C.cyan);
  label(ctx, `NHC ADVISORY ${data.assessment.advisory}  •  ${printTime(data.storm.lastUpdate)}`, 790, 255);
  rule(ctx, 288);

  const category = hurricaneCategory(data.assessment.intensity_mph, data.storm.classification);
  const metrics = [
    ["MAX WIND · NHC", `${data.assessment.intensity_mph} mph`, `${category === null ? data.storm.classification : `Category ${category}`} · ${data.storm.pressure} mb`],
    ["CENTER → WATCH", `${data.assessment.center_distance_miles} mi`, "Current center distance"],
    ["CLOSEST NHC POINT", data.assessment.forecast_point_distance_miles == null ? "—" : `${data.assessment.forecast_point_distance_miles} mi`, data.assessment.closest_forecast_hour == null ? "Forecast unavailable" : `At +${data.assessment.closest_forecast_hour}h`],
  ];
  metrics.forEach(([heading, metric, note], index) => {
    const x = 72 + index * 493;
    label(ctx, heading, x, 335);
    value(ctx, metric, x, 402, 57);
    ctx.fillStyle = C.muted; ctx.font = "400 23px Inter, system-ui, sans-serif"; ctx.fillText(note, x, 437);
  });
  rule(ctx, 465);

  label(ctx, `RADAR ${radarStatus.toUpperCase()} & OFFICIAL NHC FORECAST`, 72, 505, C.white);
  label(ctx, "NHC CONE = CENTER UNCERTAINTY, NOT IMPACT AREA", 780, 505);
  panel(ctx, 72, 525, 1456, 540);
  ctx.save(); ctx.beginPath(); ctx.roundRect(75, 528, 1450, 534, 15); ctx.clip();
  if (mapDataUrl) {
    try {
      const image = await loadImage(mapDataUrl);
      const scale = Math.max(1450 / image.width, 534 / image.height);
      const scaledWidth = image.width * scale, scaledHeight = image.height * scale;
      ctx.drawImage(image, 75 + (1450 - scaledWidth) / 2, 528 + (534 - scaledHeight) / 2, scaledWidth, scaledHeight);
    } catch { mapFallback(ctx, 75, 528, 1450, 534); }
  } else mapFallback(ctx, 75, 528, 1450, 534);
  ctx.restore();
  ctx.fillStyle = "#08111bdd"; ctx.fillRect(88, 995, 1120, 55);
  ctx.fillStyle = C.white; ctx.font = "600 23px Inter, system-ui, sans-serif";
  ctx.fillText(`Radar ${radarStatus}  ·  Coral: NHC forecast  ·  Teal: Grand Bay watch  ·  Model overlays: optional`, 106, 1030);

  label(ctx, "GRAND BAY WARNING WATCH", 72, 1120, C.white);
  label(ctx, `FULL HAZARD CHECK ${printTime(data.alerts_checked_at ?? data.checked_at)}`, 690, 1120);
  rule(ctx, 1135);
  const alerts = data.alerts ?? [];
  if (data.alerts_status === "ready" && alerts.length === 0) paragraph(ctx, "No NWS alerts returned for the watched point at the last full hazard check.", 72, 1185, 1300, 36, 2, C.muted);
  else if (data.alerts_status !== "ready") paragraph(ctx, "NWS alert availability is incomplete. Check official NWS warnings directly.", 72, 1185, 1300, 36, 2, C.coral);
  else alerts.slice(0, 6).forEach((alert, index) => {
    const x = 72 + (index % 2) * 735, y = 1185 + Math.floor(index / 2) * 56;
    ctx.fillStyle = C.coral; ctx.fillRect(x, y - 19, 7, 26);
    ctx.fillStyle = C.white; ctx.font = "700 27px Inter, system-ui, sans-serif";
    ctx.fillText((alert.event ?? "NWS alert").slice(0, 32), x + 20, y);
    ctx.fillStyle = C.muted; ctx.font = "400 20px Inter, system-ui, sans-serif";
    ctx.fillText(alert.expires ? `Expires ${printTime(alert.expires)}` : "See NWS for details", x + 20, y + 27);
  });
  const regionalEvents = (data.coastal_context_alerts ?? []).map((alert) => alert.event).filter(Boolean);
  const regional = data.coastal_context_status === "ready"
    ? regionalEvents.slice(0, 2).join(", ") + (regionalEvents.length > 2 ? ` +${regionalEvents.length - 2} more` : "") || "No additional warnings"
    : "Check NWS coastal-zone warnings";
  label(ctx, `COASTAL ZONE (NOT ADDRESS-LEVEL): ${regional}  ·  LSR: ${data.reports_status === "ready" ? data.reports?.length ?? 0 : "UNAVAILABLE"}`, 72, 1378, C.gold);
  rule(ctx, 1400);

  label(ctx, "MODEL GUIDANCE · SECONDARY", 72, 1440, C.white);
  label(ctx, `LATEST CYCLE ${printTime(data.model_guidance?.latest_cycle)}`, 800, 1440);
  const guidance = data.model_guidance;
  sourceLine(ctx, "48H TRACK SPREAD", guidance?.spread_48h_miles == null ? "Unavailable" : `${guidance.spread_48h_miles} mi`, 72, 1490);
  sourceLine(ctx, "48H MAX-WIND GUIDANCE", guidance?.wind_48h_mph_range ? `${guidance.wind_48h_mph_range[0]}–${guidance.wind_48h_mph_range[1]} mph` : "Unavailable", 500, 1490);
  sourceLine(ctx, "VALID TIME", printTime(guidance?.comparison_valid_time), 1000, 1490);
  const modelRows = guidance?.models ?? [];
  modelRows.slice(0, 5).forEach((model, index) => {
    const x = 72 + index * 291;
    panel(ctx, x, 1550, 278, 120);
    ctx.fillStyle = [C.gold, C.purple, C.blue, C.white, C.cyan][index]; ctx.fillRect(x + 17, 1572, 8, 25);
    label(ctx, model.name, x + 38, 1592, C.white);
    ctx.fillStyle = C.muted; ctx.font = "500 21px Inter, system-ui, sans-serif";
    ctx.fillText(`Closest: ${model.closest_center_miles} mi`, x + 18, 1628);
    ctx.fillText(`48h shift: ${model.shift_48h_miles == null ? "—" : `${model.shift_48h_miles} mi`}`, x + 18, 1657);
  });
  label(ctx, "Model center distance is not an address-level hazard forecast.", 72, 1705);
  rule(ctx, 1730);

  label(ctx, "OBSERVED INTENSITY TREND", 72, 1770, C.white);
  const trend = data.observed_trend;
  value(ctx, trend?.wind_change_mph == null ? "—" : `${trend.wind_change_mph > 0 ? "+" : ""}${trend.wind_change_mph} mph`, 72, 1830, 49, C.cyan);
  label(ctx, `WIND CHANGE OVER ${trend?.period_hours ?? "—"}H`, 72, 1865);
  sourceLine(ctx, "PRESSURE CHANGE", trend?.pressure_change_mb == null ? "—" : `${trend.pressure_change_mb > 0 ? "+" : ""}${trend.pressure_change_mb} mb`, 410, 1805);
  chart(ctx, data, 850, 1780, 640, 130);
  label(ctx, "SOLID: OBSERVED  ·  DASHED: NHC FORECAST", 850, 1940);
  rule(ctx, 1960);

  label(ctx, "AEGIS ANALYSIS", 72, 2000, C.white);
  const interpretation = data.ai?.status === "ready" && data.ai.summary ? data.ai.summary : "AI interpretation unavailable. Refer to the official NHC advisory and NWS warnings.";
  paragraph(ctx, interpretation, 72, 2045, 1110, 36, 3);
  ctx.fillStyle = C.coral; ctx.fillRect(1215, 1993, 4, 135);
  paragraph(ctx, "For decisions, follow NHC, NWS and local officials.", 1240, 2018, 280, 32, 4, C.muted);
  rule(ctx, 2150);
  label(ctx, `ASSESSMENT ${printTime(data.assessment.updated_at)}  ·  ${data.freshness === "stale" ? "STALE" : "CURRENT"}`, 72, 2185);
  label(ctx, "SOURCES: NHC · NWS · NOAA ATCF · OPS.CODEBLACKWX.COM/HURRICANE", 680, 2185);

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png"));
}
