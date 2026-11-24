"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import {
  HABIT_CADENCE_TYPES,
  HABIT_COMMENT_MODES,
  HABIT_LOG_STATUSES,
  type HabitLogRecord,
  type HabitRecord,
  type HabitTrackerSettingsRecord,
  type TaskRecord,
} from "@/server/db/schema";
import { parseHabitHistoryImport } from "@/server/domain/habit-import";
import { getLocalDateKey } from "@/server/domain/habit-analytics";
import { habitService } from "@/server/services/habit-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm (24h) format.");

const optionalTimeSchema = z
  .union([timeHHmmSchema, z.literal(""), z.null()])
  .optional()
  .transform((val) => (val === "" ? null : val));

const createHabitSchema = z.object({
  title: z.string().trim().min(1, "Habit title is required.").max(120),
  description: z.string().max(1_000).nullable().optional(),
  category: z.string().max(48).nullable().optional(),
  cadenceType: z.enum(HABIT_CADENCE_TYPES).optional(),
  scheduledDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeklyTargetCount: z.number().int().min(1).max(7).nullable().optional(),
  startDate: dateKeySchema.optional(),
  preferredTime: optionalTimeSchema,
  linkedProjectId: z.string().min(1).nullable().optional(),
  autoSyncDailyTask: z.boolean().optional(),
});

const updateHabitSchema = z.object({
  habitId: z.string().min(1),
  title: z.string().trim().min(1, "Habit title is required.").max(120).optional(),
  description: z.string().max(1_000).nullable().optional(),
  category: z.string().max(48).nullable().optional(),
  cadenceType: z.enum(HABIT_CADENCE_TYPES).optional(),
  scheduledDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeklyTargetCount: z.number().int().min(1).max(7).nullable().optional(),
  startDate: dateKeySchema.optional(),
  preferredTime: optionalTimeSchema,
  linkedProjectId: z.string().min(1).nullable().optional(),
  autoSyncDailyTask: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

const archiveHabitSchema = z.object({
  habitId: z.string().min(1),
  isArchived: z.boolean().default(true),
});

const deleteHabitSchema = z.object({
  habitId: z.string().min(1),
});

const logHabitDaySchema = z.object({
  habitId: z.string().min(1),
  dateKey: dateKeySchema,
  status: z.enum(HABIT_LOG_STATUSES).nullable(),
  note: z.string().max(280, "Micro-note must be 280 characters or fewer.").nullable().optional(),
});

const updateHabitSettingsSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  defaultCommentMode: z.enum(HABIT_COMMENT_MODES).optional(),
  defaultWindowStartDay: z.number().int().min(0).max(6).optional(),
  defaultWindowStartTime: timeHHmmSchema.optional(),
  defaultWindowEndDay: z.number().int().min(0).max(6).optional(),
  defaultWindowEndTime: timeHHmmSchema.optional(),
  defaultIntervalDays: z.number().int().min(1).max(30).nullable().optional(),
  defaultIntervalAnchorDate: z
    .union([dateKeySchema, z.literal(""), z.null()])
    .optional()
    .transform((val) => (val === "" ? null : val)),
  defaultIntervalOpenHours: z.number().int().min(1).max(168).optional(),
  allowReactionsWhenLocked: z.boolean().optional(),
  eveningCheckinTime: optionalTimeSchema,
});

const promoteTaskToHabitSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  category: z.string().max(48).nullable().optional(),
  cadenceType: z.enum(HABIT_CADENCE_TYPES).optional(),
  scheduledDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeklyTargetCount: z.number().int().min(1).max(7).nullable().optional(),
  preferredTime: optionalTimeSchema,
  autoSyncDailyTask: z.boolean().optional(),
});

const bulkImportHabitsSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(1, "Paste at least one habit title or CSV row.")
    .max(20_000),
});

const monthRosterSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM."),
  titles: z.array(z.string().trim().min(1).max(120)).max(500),
});

const aliasOverrideSchema = z.object({
  sourceTitle: z.string().trim().min(1).max(120),
  canonicalTitle: z.string().trim().min(1).max(120),
});

const bulkImportHistorySchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(1, "Paste at least one habit row to import.")
    .max(1_000_000),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM.")
    .optional(),
  createMissing: z.boolean().default(true),
  archiveRemoved: z.boolean().default(true),
  monthRosters: z.array(monthRosterSchema).max(240).default([]),
  aliasOverrides: z.array(aliasOverrideSchema).max(500).default([]),
});

function revalidateHabitPaths() {
  revalidatePath("/app", "layout");
  revalidatePath("/app/habits");
  revalidatePath("/app/habits/circle", "layout");
  revalidatePath("/app/today");
  revalidatePath("/app/inbox");
  revalidatePath("/app/upcoming");
  revalidatePath("/app/projects", "layout");
}

export async function createHabitAction(
  input: z.input<typeof createHabitSchema>
): Promise<ActionResult<HabitRecord>> {
  const parsed = createHabitSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please check your habit details.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const created = await habitService.createHabit(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateHabitAction(
  input: z.input<typeof updateHabitSchema>
): Promise<ActionResult<HabitRecord>> {
  const parsed = updateHabitSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please check your habit updates.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const { habitId, ...patch } = parsed.data;
    const updated = await habitService.updateHabit(user.id, habitId, patch);
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function archiveHabitAction(
  input: z.input<typeof archiveHabitSchema>
): Promise<ActionResult<HabitRecord>> {
  const parsed = archiveHabitSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid habit archive request.");
  }

  try {
    const { user } = await requireSession();
    const updated = await habitService.archiveHabit(
      user.id,
      parsed.data.habitId,
      parsed.data.isArchived
    );
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteHabitAction(
  input: z.input<typeof deleteHabitSchema>
): Promise<ActionResult<{ deletedId: string }>> {
  const parsed = deleteHabitSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid habit identifier.");
  }

  try {
    const { user } = await requireSession();
    await habitService.deleteHabit(user.id, parsed.data.habitId);
    revalidateHabitPaths();
    return actionOk({ deletedId: parsed.data.habitId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function logHabitDayAction(
  input: z.input<typeof logHabitDaySchema>
): Promise<ActionResult<{ log: HabitLogRecord | null; syncedTaskCount: number }>> {
  const parsed = logHabitDaySchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid habit log input."
    );
  }

  try {
    const { user } = await requireSession();
    const result = await habitService.logHabitDay(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateHabitSettingsAction(
  input: z.input<typeof updateHabitSettingsSchema>
): Promise<ActionResult<HabitTrackerSettingsRecord>> {
  const parsed = updateHabitSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid habit settings.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const updated = await habitService.updateSettings(user.id, parsed.data);
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function promoteTaskToHabitAction(
  input: z.input<typeof promoteTaskToHabitSchema>
): Promise<
  ActionResult<{
    habit: HabitRecord;
    task: TaskRecord;
    initialLog: HabitLogRecord | null;
  }>
> {
  const parsed = promoteTaskToHabitSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid habit promotion details."
    );
  }

  try {
    const { user } = await requireSession();
    const { taskId, ...opts } = parsed.data;
    const promoted = await habitService.promoteTaskToHabit(
      user.id,
      user.timezone || "UTC",
      taskId,
      opts
    );
    revalidateHabitPaths();
    return actionOk(promoted);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function bulkImportHabitsAction(
  input: z.input<typeof bulkImportHabitsSchema>
): Promise<ActionResult<{ importedCount: number; habits: HabitRecord[] }>> {
  const parsed = bulkImportHabitsSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please provide valid habit rows."
    );
  }

  try {
    const { user } = await requireSession();
    const created = await habitService.bulkImportHabits(
      user.id,
      user.timezone || "UTC",
      parsed.data.rawText
    );
    revalidateHabitPaths();
    return actionOk({ importedCount: created.length, habits: created });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function bulkImportHabitHistoryAction(
  input: z.input<typeof bulkImportHistorySchema>
): Promise<
  ActionResult<{
    importedCount: number;
    createdHabits: HabitRecord[];
    archivedHabits: HabitRecord[];
    matchedTitleCount: number;
    skippedTitleCount: number;
    aliasCount: number;
    syncedTaskCount: number;
    warnings: string[];
  }>
> {
  const parsed = bulkImportHistorySchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please provide valid history rows."
    );
  }

  try {
    const { user } = await requireSession();
    const timezone = user.timezone || "UTC";
    const source = parseHabitHistoryImport(parsed.data.rawText, {
      month: parsed.data.month,
      todayDateKey: getLocalDateKey(Date.now(), timezone),
    });
    if (source.error) {
      return actionErr("VALIDATION_ERROR", source.error);
    }

    const result = await habitService.bulkImportHistory(
      user.id,
      timezone,
      {
        rows: source.rows,
        createMissing: parsed.data.createMissing,
        archiveRemoved: parsed.data.archiveRemoved,
        monthRosters: parsed.data.monthRosters,
        aliasOverrides: parsed.data.aliasOverrides,
      }
    );

    revalidateHabitPaths();
    return actionOk({
      ...result,
      warnings: [...source.warnings, ...result.warnings],
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
