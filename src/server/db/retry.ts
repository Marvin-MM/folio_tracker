export interface DbRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxJitterMs?: number;
}

const TRANSIENT_SQLITE_PATTERNS = [
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "database is locked",
  "database table is locked",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_BUSY_RECOVERY",
];

function extractErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let cursor: unknown = error;
  let depth = 0;

  while (cursor && depth < 5) {
    depth += 1;
    if (cursor instanceof Error) {
      messages.push(cursor.message);
      const withCode = cursor as Error & { code?: unknown; cause?: unknown };
      if (typeof withCode.code === "string") {
        messages.push(withCode.code);
      }
      cursor = withCode.cause;
    } else if (typeof cursor === "object") {
      const record = cursor as Record<string, unknown>;
      if (typeof record.message === "string") messages.push(record.message);
      if (typeof record.code === "string") messages.push(record.code);
      cursor = record.cause;
    } else if (typeof cursor === "string") {
      messages.push(cursor);
      break;
    } else {
      break;
    }
  }

  return messages;
}

export function isTransientSqliteBusyError(error: unknown): boolean {
  const combined = extractErrorMessages(error).join(" ");
  if (!combined) return false;
  return TRANSIENT_SQLITE_PATTERNS.some((pattern) =>
    combined.includes(pattern)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries transient SQLite / libSQL lock contention (`SQLITE_BUSY` / `SQLITE_LOCKED`)
 * with bounded exponential backoff and random jitter on idempotent/transactional writes.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  options: DbRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 50);
  const maxJitterMs = Math.max(0, options.maxJitterMs ?? 35);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientSqliteBusyError(error)) {
        throw error;
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = maxJitterMs > 0 ? Math.floor(Math.random() * maxJitterMs) : 0;
      await sleep(backoff + jitter);
    }
  }
}
