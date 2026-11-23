import { describe, expect, it } from "vitest";
import {
  DEFAULT_INNGEST_CONCURRENCY,
  INNGEST_CRON_CONCURRENCY,
  resolveInngestConcurrency,
} from "@/server/inngest/client";
import { inngestFunctions } from "@/server/inngest/registry";

interface InspectableInngestFn {
  opts?: {
    id?: string;
    concurrency?: number | { limit: number } | Array<{ limit: number }>;
    triggers?: Array<{ cron?: string; event?: string }>;
  };
}

function extractConcurrencyLimits(
  concurrency:
    | number
    | { limit: number }
    | Array<{ limit: number }>
    | undefined
): number[] {
  if (typeof concurrency === "number") return [concurrency];
  if (Array.isArray(concurrency)) {
    return concurrency.map((entry) => entry.limit);
  }
  if (concurrency && typeof concurrency.limit === "number") {
    return [concurrency.limit];
  }
  return [];
}

describe("Inngest Free-Plan Concurrency & Function Registry", () => {
  it("defaults concurrency to 5 and safely parses positive integer overrides", () => {
    expect(DEFAULT_INNGEST_CONCURRENCY).toBe(5);
    expect(INNGEST_CRON_CONCURRENCY).toBe(1);

    expect(resolveInngestConcurrency(undefined)).toBe(5);
    expect(resolveInngestConcurrency("")).toBe(5);
    expect(resolveInngestConcurrency("   ")).toBe(5);
    expect(resolveInngestConcurrency("0")).toBe(5);
    expect(resolveInngestConcurrency("-4")).toBe(5);
    expect(resolveInngestConcurrency("abc")).toBe(5);
    expect(resolveInngestConcurrency("2.5")).toBe(5);

    expect(resolveInngestConcurrency("3")).toBe(3);
    expect(resolveInngestConcurrency("5")).toBe(5);
    expect(resolveInngestConcurrency("25")).toBe(25);
  });

  it("registers all 13 unique functions within the Free-Plan concurrency limit (<= 5)", () => {
    expect(inngestFunctions).toHaveLength(13);

    const seenIds = new Set<string>();

    for (const rawFn of inngestFunctions) {
      const fn = rawFn as unknown as InspectableInngestFn;
      const id = fn.opts?.id;
      expect(id, "Every Inngest function must declare a stable id").toBeTruthy();
      expect(seenIds.has(id!)).toBe(false);
      seenIds.add(id!);

      const limits = extractConcurrencyLimits(fn.opts?.concurrency);
      expect(
        limits.length,
        `Function '${id}' must explicitly set concurrency`
      ).toBeGreaterThan(0);

      for (const limit of limits) {
        expect(
          limit,
          `Function '${id}' concurrency (${limit}) must be between 1 and Free-Plan cap (${DEFAULT_INNGEST_CONCURRENCY})`
        ).toBeGreaterThanOrEqual(1);
        expect(
          limit,
          `Function '${id}' concurrency (${limit}) exceeds Inngest Free-Plan limit (${DEFAULT_INNGEST_CONCURRENCY})`
        ).toBeLessThanOrEqual(DEFAULT_INNGEST_CONCURRENCY);
      }

      const isCron = (fn.opts?.triggers ?? []).some(
        (trigger) => typeof trigger.cron === "string"
      );
      if (isCron) {
        expect(
          limits,
          `Cron function '${id}' should enforce singleton concurrency (1)`
        ).toEqual([1]);
      }
    }
  });
});
