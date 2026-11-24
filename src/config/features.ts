/**
 * Feature flags for incremental rollout.
 * Defaults: OFF until a phase passes review; Phase A foundations ON.
 * Flags must be checked before rendering/executing gated behavior.
 */
export const features = {
  // Phase A — foundation
  phaseAFoundation: true,
  excuseRanges: true,
  effectiveStatus: true,
  undoStack: true,

  // Phase B
  habitMetadata: false,
  savedViews: false,
  missReasonPrompt: false,

  // Phase C
  dayPage: false,
  energySleepInput: false,
  rollups: false,

  // Phase D
  quickActions: false,
  studyTimer: false,
  automations: false,
  conditionalReminders: false,

  // Phase E
  reviewTemplates: false,

  // Phase F
  dashboardWidgets: false,

  // Phase G
  globalSearch: false,
  quickCaptureV2: false,

  // Phase H
  insights: false,
} as const;

export type FeatureFlag = keyof typeof features;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
