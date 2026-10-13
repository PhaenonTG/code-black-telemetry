export interface FabricReconnectPlan {
  delayMs: number;
  markClosed: boolean;
}

export function planFabricReconnect(
  completedNormally: boolean,
  receivedSnapshot: boolean,
  nextBackoff: () => number,
): FabricReconnectPlan {
  if (completedNormally && receivedSnapshot) {
    return { delayMs: 0, markClosed: false };
  }
  return { delayMs: nextBackoff(), markClosed: true };
}
