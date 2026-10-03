// BROADCAST RADAR IS SERVER-SIDE ONLY. THE CHASE APP DOES NOT RENDER RADAR.
// Master switch: while false, Chase performs no radar fetching, polling, decoding, layer work or timers.
// Revert = set true (all radar code paths below remain in place, gated by this flag).
export const CHASE_RADAR_ENABLED = false;
