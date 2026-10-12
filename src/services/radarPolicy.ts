// The native Chase build keeps radar disabled. The separate OPS desk enables its existing
// radar renderer at build time; it must not change the native app's policy as a side effect.
export const CHASE_RADAR_ENABLED = import.meta.env.VITE_OPS_RADAR_ENABLED === "true";
