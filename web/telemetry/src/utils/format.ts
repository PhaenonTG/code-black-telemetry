export function fixed(value: number, decimals = 0) {
  return value.toFixed(decimals);
}

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function timeLabel(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function ageSeconds(updatedAt: number) {
  return Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
}

export function freshnessLabel(updatedAt: number) {
  const age = ageSeconds(updatedAt);
  if (age < 3) return "LIVE";
  if (age < 15) return `${age}s`;
  if (age < 90) return `STALE ${age}s`;
  return `OLD ${Math.round(age / 60)}m`;
}

export function uptimeLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
