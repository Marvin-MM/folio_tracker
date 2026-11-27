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

export function setEphemeralRunSecrets(
  runId: string,
  secrets: Record<string, string>
): void {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (value.length > 0) {
      cleaned[key] = value;
    }
  }
  if (Object.keys(cleaned).length === 0) {
    runSecretsMemory.delete(runId);
    return;
  }
  runSecretsMemory.set(runId, cleaned);
}

export function getEphemeralRunSecrets(runId: string): Record<string, string> {
  return { ...(runSecretsMemory.get(runId) ?? {}) };
}

export function clearEphemeralRunSecrets(runId: string): void {
  runSecretsMemory.delete(runId);
}

export function clearAllEphemeralRunSecrets(): void {
  runSecretsMemory.clear();
}
