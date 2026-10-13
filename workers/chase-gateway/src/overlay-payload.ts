export function validOverlayPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) return false;
  return Object.entries(value).every(([key, item]) => {
    if (["callsign", "vehicle"].includes(key)) return typeof item === "string" && Boolean(item.trim()) && item.length <= 24 && !/[\x00-\x1f\x7f]/.test(item);
    if (!["bug", "live", "lowerThird", "sourceName"].includes(key) || !item || typeof item !== "object" || Array.isArray(item) || !Object.keys(item).length) return false;
    return Object.entries(item).every(([field, next]) => field === "enabled" ? typeof next === "boolean" : field === "text" && ["bug", "lowerThird"].includes(key) && typeof next === "string" && next.length <= (key === "bug" ? 24 : 120) && !/[\x00-\x1f\x7f]/.test(next));
  });
}
