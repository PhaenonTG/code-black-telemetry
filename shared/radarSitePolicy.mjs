// Configuration is an allowlist, never a browser-selected upstream or new permission.
export const radarSitePattern = /^[A-Z]{4}$/;
export function configuredRadarSites(value) {
  if (typeof value !== 'string' || !value || value.length > 79) return [];
  const sites = value.split(',');
  return sites.length <= 16 && new Set(sites).size === sites.length && sites.every(site => radarSitePattern.test(site)) ? sites : [];
}
export function originRadarSites(env) {
  return configuredRadarSites(env.OPS_PRIVATE_RADAR_SITES ?? env.OPS_PRIVATE_RADAR_SITE);
}
