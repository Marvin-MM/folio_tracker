import type { NextRequest } from "next/server";
import { z } from "zod";
import { HABIT_LOG_STATUSES } from "@/server/db/schema";
import {
  withWorkspaceAuth,
  workspaceErrorJson,
  workspaceJson,
} from "@/server/http/workspace-api";
import { defaultRateLimiter } from "@/server/providers/redis/rate-limiter";
import { habitService } from "@/server/services/habit-service";

export const maxDuration = 60;

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");

const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM.");

const preparePhaseSchema = z.object({
  phase: z.literal("prepare"),
  habits: z
    .array(
      z.object({
        canonicalTitle: z.string().trim().min(1).max(120),
        firstDate: dateKeySchema,
        lastDate: dateKeySchema,
        lastMonth: yearMonthSchema,
        sourceTitles: z.array(z.string().trim().min(1).max(120)).max(50),
      })
    )
    .min(1)
    .max(500),
  months: z.array(yearMonthSchema).min(1).max(240),
  firstMonth: yearMonthSchema.nullable(),
  lastMonth: yearMonthSchema.nullable(),
  createMissing: z.boolean().default(true),
  archiveRemoved: z.boolean().default(true),
  allowAutoLockedBackfill: z.boolean().default(true),
  aliasEntries: z
    .array(
      z.object({
        sourceTitle: z.string().trim().min(1).max(120),
        canonicalTitle: z.string().trim().min(1).max(120),
        firstDate: dateKeySchema,
        lastDate: dateKeySchema,
      })
    )
    .max(1_000)
    .default([]),
});

const chunkPhaseSchema = z.object({
  phase: z.literal("chunk"),
  allowAutoLockedBackfill: z.boolean().default(true),
  // Compact [habitId, dateKey, status] tuples keep JSON payload ~45 KB per 1,500 marks
  entries: z
    .array(
      z.tuple([z.string().min(1).max(64), dateKeySchema, z.enum(HABIT_LOG_STATUSES)])
    )
    .min(1)
    .max(2_000),
});

const importRequestSchema = z.discriminatedUnion("phase", [
  preparePhaseSchema,
  chunkPhaseSchema,
]);

export async function POST(request: NextRequest) {
  return withWorkspaceAuth(async ({ user }) => {
    const rate = await defaultRateLimiter.limit("habit_history_import", user.id);
    if (!rate.allowed) {
      return workspaceErrorJson(
        "RATE_LIMITED",
        `Import rate limit reached. Please retry in ${rate.retryAfterSeconds}s.`,
        429
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return workspaceErrorJson(
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        400
      );
    }

    const parsed = importRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return workspaceErrorJson(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid history import payload.",
        400
      );
    }

    const timezone = user.timezone || "UTC";

    if (parsed.data.phase === "prepare") {
      const prepared = await habitService.prepareBulkHistoryImport(
        user.id,
        timezone,
        {
          habits: parsed.data.habits,
          months: parsed.data.months,
          firstMonth: parsed.data.firstMonth,
          lastMonth: parsed.data.lastMonth,
          createMissing: parsed.data.createMissing,
          archiveRemoved: parsed.data.archiveRemoved,
          allowAutoLockedBackfill: parsed.data.allowAutoLockedBackfill,
          aliasEntries: parsed.data.aliasEntries,
        }
      );
      return workspaceJson({ ok: true, phase: "prepare" as const, data: prepared });
    }

    const chunkRes = await habitService.importBulkHistoryChunk(
      user.id,
      timezone,
      {
        allowAutoLockedBackfill: parsed.data.allowAutoLockedBackfill,
        entries: parsed.data.entries.map(([habitId, dateKey, status]) => ({
          habitId,
          dateKey,
          status,
        })),
      }
    );

    return workspaceJson({ ok: true, phase: "chunk" as const, data: chunkRes });
  });
}
