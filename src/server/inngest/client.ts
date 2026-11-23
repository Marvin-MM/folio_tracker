import { Inngest } from "inngest";

/**
 * Default per-function concurrency ceiling compatible with the Inngest Free
 * Plan (which enforces a hard plan limit of 5 concurrent steps).
 *
 * Override via `INNGEST_CONCURRENCY_LIMIT` (e.g. `25`) when running on a paid
 * Inngest plan, then re-sync `/api/inngest`.
 */
export const DEFAULT_INNGEST_CONCURRENCY = 5;

/**
 * Singleton concurrency limit for periodic cron sweepers so overlapping ticks
 * never double-scan or waste monthly Free-Plan executions.
 */
export const INNGEST_CRON_CONCURRENCY = 1;

export function resolveInngestConcurrency(
  rawValue: string | undefined = process.env.INNGEST_CONCURRENCY_LIMIT
): number {
  const trimmed = rawValue?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return DEFAULT_INNGEST_CONCURRENCY;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_INNGEST_CONCURRENCY;
  }

  return parsed;
}

export const INNGEST_CONCURRENCY_LIMIT = resolveInngestConcurrency();

const isDev =
  process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development";

export const inngest = new Inngest({
  id: "folio",
  isDev,
  ...(process.env.INNGEST_EVENT_KEY?.trim()
    ? { eventKey: process.env.INNGEST_EVENT_KEY.trim() }
    : {}),
  ...(process.env.INNGEST_SIGNING_KEY?.trim()
    ? { signingKey: process.env.INNGEST_SIGNING_KEY.trim() }
    : {}),
});
