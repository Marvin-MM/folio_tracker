/**
 * Feature flags for incremental rollout of habit extensions (Phases A–C).
 * Flags are checked before rendering or executing gated behavior.
 */
export const features = {
  // Phase A — foundation
  phaseAFoundation: true,
  excuseRanges: true,
  effectiveStatus: true,
  undoStack: true,

  // Phase B — habit metadata, saved views, and miss reasons
  habitMetadata: true,
  savedViews: true,
  missReasonPrompt: true,

  // Phase C — day ledger page, energy/sleep inputs, and computed rollups
  dayPage: false,
  energySleepInput: false,
  rollups: false,
} as const;

export type FeatureFlag = keyof typeof features;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
