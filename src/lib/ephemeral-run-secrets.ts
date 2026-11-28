"use client";

/**
 * Strictly RAM-only secret variable handoff store for active Operation Runs.
 *
 * SECURITY INVARIANT:
 * - Lives purely in a JavaScript module `Map` in browser memory.
 * - NEVER touches `localStorage`, `sessionStorage`, IndexedDB, cookies, URLs, or Turso.
 * - Automatically wiped on page reload, tab close, or `performSecureSignOut()`.
 */
const runSecretsMemory = new Map<string, Record<string, string>>();

function getSecretKey(userId: string, runId: string): string {
  return `${userId}:${runId}`;
}

export function setEphemeralRunSecrets(
  userId: string,
  runId: string,
  secrets: Record<string, string>
): void {
  if (!userId || !runId) return;
  const key = getSecretKey(userId, runId);
  const cleaned: Record<string, string> = {};
  for (const [varKey, value] of Object.entries(secrets)) {
    if (value.length > 0) {
      cleaned[varKey] = value;
    }
  }
  if (Object.keys(cleaned).length === 0) {
    runSecretsMemory.delete(key);
    return;
  }
  runSecretsMemory.set(key, cleaned);
}

export function getEphemeralRunSecrets(
  userId: string,
  runId: string
): Record<string, string> {
  if (!userId || !runId) return {};
  return { ...(runSecretsMemory.get(getSecretKey(userId, runId)) ?? {}) };
}

export function clearEphemeralRunSecrets(userId: string, runId: string): void {
  if (!userId || !runId) return;
  runSecretsMemory.delete(getSecretKey(userId, runId));
}

export function clearAllEphemeralRunSecrets(): void {
  runSecretsMemory.clear();
}
