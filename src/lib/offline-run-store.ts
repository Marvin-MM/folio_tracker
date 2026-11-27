"use client";

import type { OperationRunStepStatus } from "@/server/db/schema";
import {
  stripSecretVariables,
  type OperationVariable,
} from "@/server/domain/operations";

const OFFLINE_RUN_STORAGE_PREFIX = "folio:offline-run:";

export interface OfflineRunStepMutation {
  stepKey: string;
  status: OperationRunStepStatus;
  note?: string | null;
  queuedAtMs: number;
}

export interface OfflineRunPreflightMutation {
  title?: string;
  variablesValues?: Record<string, string>;
  prerequisitesChecked?: string[];
  queuedAtMs: number;
}

export interface OfflineRunCacheRecord {
  runId: string;
  userId: string;
  savedAtMs: number;
  /** Strictly non-secret variable values only! */
  variablesValues: Record<string, string>;
  prerequisitesChecked: string[];
  stepStates: Record<
    string,
    {
      status: OperationRunStepStatus;
      note: string | null;
      completedAt: number | null;
      updatedAt: number;
    }
  >;
  pendingPreflight: OfflineRunPreflightMutation | null;
  pendingStepMutations: Record<string, OfflineRunStepMutation>;
}

function getStorageKey(userId: string, runId: string): string {
  return `${OFFLINE_RUN_STORAGE_PREFIX}${userId}:${runId}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadOfflineRunCache(
  userId: string,
  runId: string
): OfflineRunCacheRecord | null {
  if (!canUseStorage() || !userId || !runId) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId, runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineRunCacheRecord>;
    if (
      !parsed ||
      parsed.runId !== runId ||
      parsed.userId !== userId ||
      typeof parsed.stepStates !== "object"
    ) {
      return null;
    }
    return {
      runId,
      userId,
      savedAtMs: typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : Date.now(),
      variablesValues:
        parsed.variablesValues && typeof parsed.variablesValues === "object"
          ? parsed.variablesValues
          : {},
      prerequisitesChecked: Array.isArray(parsed.prerequisitesChecked)
        ? parsed.prerequisitesChecked
        : [],
      stepStates: parsed.stepStates ?? {},
      pendingPreflight: parsed.pendingPreflight ?? null,
      pendingStepMutations: parsed.pendingStepMutations ?? {},
    };
  } catch {
    return null;
  }
}

export function saveOfflineRunSnapshot(params: {
  userId: string;
  runId: string;
  variablesSchema: readonly OperationVariable[];
  variablesValues: Record<string, string>;
  prerequisitesChecked: string[];
  stepStates: OfflineRunCacheRecord["stepStates"];
  pendingPreflight?: OfflineRunPreflightMutation | null;
  pendingStepMutations?: Record<string, OfflineRunStepMutation>;
}): OfflineRunCacheRecord | null {
  if (!canUseStorage() || !params.userId || !params.runId) return null;

  // STRICT SECURITY INVARIANT: Strip ALL secret variables before writing to localStorage!
  const safeValues = stripSecretVariables(
    params.variablesValues,
    params.variablesSchema
  );
  const existing = loadOfflineRunCache(params.userId, params.runId);

  const nextPendingPreflight =
    params.pendingPreflight !== undefined
      ? params.pendingPreflight
        ? {
            ...params.pendingPreflight,
            ...(params.pendingPreflight.variablesValues !== undefined
              ? {
                  variablesValues: stripSecretVariables(
                    params.pendingPreflight.variablesValues,
                    params.variablesSchema
                  ),
                }
              : {}),
          }
        : null
      : (existing?.pendingPreflight ?? null);

  const record: OfflineRunCacheRecord = {
    runId: params.runId,
    userId: params.userId,
    savedAtMs: Date.now(),
    variablesValues: safeValues,
    prerequisitesChecked: [...params.prerequisitesChecked],
    stepStates: params.stepStates,
    pendingPreflight: nextPendingPreflight,
    pendingStepMutations:
      params.pendingStepMutations ?? existing?.pendingStepMutations ?? {},
  };

  try {
    window.localStorage.setItem(
      getStorageKey(params.userId, params.runId),
      JSON.stringify(record)
    );
    return record;
  } catch {
    return null;
  }
}

export function queueOfflineStepMutation(params: {
  userId: string;
  runId: string;
  variablesSchema: readonly OperationVariable[];
  variablesValues: Record<string, string>;
  prerequisitesChecked: string[];
  stepStates: OfflineRunCacheRecord["stepStates"];
  mutation: {
    stepKey: string;
    status: OperationRunStepStatus;
    note?: string | null;
  };
}): OfflineRunCacheRecord | null {
  const existing = loadOfflineRunCache(params.userId, params.runId);
  const nextPendingSteps = {
    ...(existing?.pendingStepMutations ?? {}),
    [params.mutation.stepKey]: {
      stepKey: params.mutation.stepKey,
      status: params.mutation.status,
      note: params.mutation.note,
      queuedAtMs: Date.now(),
    },
  };

  return saveOfflineRunSnapshot({
    userId: params.userId,
    runId: params.runId,
    variablesSchema: params.variablesSchema,
    variablesValues: params.variablesValues,
    prerequisitesChecked: params.prerequisitesChecked,
    stepStates: params.stepStates,
    pendingPreflight: existing?.pendingPreflight ?? null,
    pendingStepMutations: nextPendingSteps,
  });
}

export function queueOfflinePreflightMutation(params: {
  userId: string;
  runId: string;
  variablesSchema: readonly OperationVariable[];
  variablesValues: Record<string, string>;
  prerequisitesChecked: string[];
  stepStates: OfflineRunCacheRecord["stepStates"];
  title?: string;
}): OfflineRunCacheRecord | null {
  const existing = loadOfflineRunCache(params.userId, params.runId);
  const safeValues = stripSecretVariables(
    params.variablesValues,
    params.variablesSchema
  );

  return saveOfflineRunSnapshot({
    userId: params.userId,
    runId: params.runId,
    variablesSchema: params.variablesSchema,
    variablesValues: safeValues,
    prerequisitesChecked: params.prerequisitesChecked,
    stepStates: params.stepStates,
    pendingPreflight: {
      ...(params.title ? { title: params.title } : {}),
      variablesValues: safeValues,
      prerequisitesChecked: [...params.prerequisitesChecked],
      queuedAtMs: Date.now(),
    },
    pendingStepMutations: existing?.pendingStepMutations ?? {},
  });
}

export function clearPendingOfflineMutations(
  userId: string,
  runId: string,
  variablesSchema: readonly OperationVariable[]
): void {
  const existing = loadOfflineRunCache(userId, runId);
  if (!existing) return;
  saveOfflineRunSnapshot({
    userId,
    runId,
    variablesSchema,
    variablesValues: existing.variablesValues,
    prerequisitesChecked: existing.prerequisitesChecked,
    stepStates: existing.stepStates,
    pendingPreflight: null,
    pendingStepMutations: {},
  });
}

export function removeOfflineRunCache(userId: string, runId: string): void {
  if (!canUseStorage() || !userId || !runId) return;
  try {
    window.localStorage.removeItem(getStorageKey(userId, runId));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function countPendingOfflineMutations(
  cache: OfflineRunCacheRecord | null
): number {
  if (!cache) return 0;
  return (
    Object.keys(cache.pendingStepMutations).length +
    (cache.pendingPreflight ? 1 : 0)
  );
}

/**
 * Shared-device security invariant: purges ALL offline operation run caches
 * from `localStorage` during `performSecureSignOut()`.
 */
export function clearAllOfflineRunCaches(): void {
  if (!canUseStorage()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(OFFLINE_RUN_STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore restricted storage environments
  }
}
