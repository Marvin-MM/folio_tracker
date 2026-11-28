"use server";

import { z } from "zod";
import { isFeatureEnabled } from "@/config/features";
import { requireSession } from "@/server/dal/auth-guard";
import { RateLimitError } from "@/server/dal/errors";
import { defaultRateLimiter } from "@/server/providers/redis/rate-limiter";
import {
  HABIT_CADENCE_TYPES,
  HABIT_COMMENT_MODES,
  HABIT_LOG_STATUSES,
  type HabitLogRecord,
  type HabitRecord,
  type TaskRecord,
} from "@/server/db/schema";
import { parseHabitHistoryImport } from "@/server/domain/habit-import";
import { getLocalDateKey } from "@/server/domain/habit-analytics";
import {
  ENERGY_NEEDS,
  LOG_SOURCES,
  MISS_REASONS,
  PLACES,
  TIME_BLOCKS,
} from "@/server/domain/habit-metadata";
import type {
  ClientHabitTrackerSettings,
  MonthLockState,
} from "@/server/domain/habit-month-lock";
import {
  VIEW_GROUP_BY,
  VIEW_KINDS,
  VIEW_SORT_BY,
  type HabitSavedView,
} from "@/server/domain/habit-views";
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

const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format.");

const habitMetadataFields = {
  energyNeed: z.enum(ENERGY_NEEDS).optional(),
  place: z.enum(PLACES).optional(),
  tags: z.array(z.string().max(32)).max(12).optional(),
};

const savedViewFilterSchema = z
  .object({
    categories: z.array(z.string().max(48)).max(12).optional(),
    timeBlocks: z.array(z.enum(TIME_BLOCKS)).max(4).optional(),
    energyNeeds: z.array(z.enum(ENERGY_NEEDS)).max(3).optional(),
    places: z.array(z.enum(PLACES)).max(4).optional(),
    tags: z.array(z.string().max(32)).max(12).optional(),
    isCore: z.boolean().optional(),
    activeToday: z.boolean().optional(),
    minRate: z.number().min(0).max(1).optional(),
    maxRate: z.number().min(0).max(1).optional(),
    hasMissReason: z.enum(MISS_REASONS).optional(),
  })
  .default({});

const createSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(48),
  kind: z.enum(VIEW_KINDS).optional(),
  filter: savedViewFilterSchema.optional(),
  groupBy: z.enum(VIEW_GROUP_BY).optional(),
  sortBy: z.enum(VIEW_SORT_BY).optional(),
});

const updateSavedViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string().trim().min(1).max(48).optional(),
  hidden: z.boolean().optional(),
  filter: savedViewFilterSchema.optional(),
  groupBy: z.enum(VIEW_GROUP_BY).optional(),
  sortBy: z.enum(VIEW_SORT_BY).optional(),
});

const deleteSavedViewSchema = z.object({
  viewId: z.string().min(1),
});

const setHabitMissReasonSchema = z.object({
  habitId: z.string().min(1),
  dateKey: dateKeySchema,
  reason: z.enum(MISS_REASONS).nullable(),
});

const saveDayEntrySchema = z
  .object({
    dateKey: dateKeySchema,
    energy: z.number().int().min(1).max(10).nullable().optional(),
    sleepHours: z.number().min(0).max(24).nullable().optional(),
    note: z.string().max(2_000).nullable().optional(),
    journalPromptId: z.string().max(64).nullable().optional(),
    journalText: z.string().max(4_000).nullable().optional(),
  })
  .refine(
    (value) =>
      value.energy !== undefined ||
      value.sleepHours !== undefined ||
      value.note !== undefined ||
      value.journalPromptId !== undefined ||
      value.journalText !== undefined,
    { message: "Nothing to save for this day." }
  );

const createHabitSchema = z.object({
  title: z.string().trim().min(1, "Habit title is required.").max(120),
  description: z.string().max(1_000).nullable().optional(),
  category: z.string().max(48).nullable().optional(),
  cadenceType: z.enum(HABIT_CADENCE_TYPES).optional(),
  scheduledDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  weeklyTargetCount: z.number().int().min(1).max(7).nullable().optional(),
  startDate: dateKeySchema.optional(),
  targetYearMonth: yearMonthSchema.optional(),
  preferredTime: optionalTimeSchema,
  ...habitMetadataFields,
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
  ...habitMetadataFields,
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
  missReason: z.enum(MISS_REASONS).nullable().optional(),
  source: z.enum(LOG_SOURCES).optional(),
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
  monthLockEnabled: z.boolean().optional(),
  monthLockGraceDays: z.number().int().min(0).max(14).optional(),
  currentPin: z.string().trim().max(12).optional(),
});

const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, "Accountability PIN must be 4 to 6 digits.");

const lockHabitMonthSchema = z.object({
  yearMonth: yearMonthSchema,
});

const unlockHabitMonthSchema = z.object({
  yearMonth: yearMonthSchema,
  pin: z.string().trim().max(12).optional(),
  reason: z.string().trim().max(200).optional(),
});

const setMonthLockPinSchema = z.object({
  currentPin: z.string().trim().max(12).optional(),
  newPin: pinSchema,
});

const removeMonthLockPinSchema = z.object({
  currentPin: pinSchema,
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
  targetYearMonth: yearMonthSchema.optional(),
});

const saveMonthRosterSchema = z.object({
  yearMonth: yearMonthSchema,
  habitIds: z.array(z.string().min(1)).max(500),
});

const carryOverMonthRosterSchema = z.object({
  targetYearMonth: yearMonthSchema,
  sourceYearMonth: yearMonthSchema.optional(),
});

const removeHabitFromMonthSchema = z.object({
  habitId: z.string().min(1),
  yearMonth: yearMonthSchema,
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
    .max(1_600_000),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM.")
    .optional(),
  createMissing: z.boolean().default(true),
  archiveRemoved: z.boolean().default(true),
  allowAutoLockedBackfill: z.boolean().default(true),
  monthRosters: z.array(monthRosterSchema).max(240).default([]),
  aliasOverrides: z.array(aliasOverrideSchema).max(500).default([]),
});

function revalidateHabitPaths() {
  // Client freshness is driven by TanStack Query domain invalidation; hard reloads read live Turso.
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

export async function setHabitMissReasonAction(
  input: z.input<typeof setHabitMissReasonSchema>
): Promise<ActionResult<HabitLogRecord>> {
  if (!isFeatureEnabled("missReasonPrompt") && !isFeatureEnabled("dayPage")) {
    return actionErr("FEATURE_DISABLED", "Miss reasons are disabled.");
  }
  const parsed = setHabitMissReasonSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid miss reason."
    );
  }

  try {
    const { user } = await requireSession();
    const updated = await habitService.setHabitMissReason(
      user.id,
      parsed.data,
      user.timezone || "UTC"
    );
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function saveDayEntryAction(
  input: z.input<typeof saveDayEntrySchema>
): Promise<ActionResult<{ dateKey: string }>> {
  if (!isFeatureEnabled("dayPage")) {
    return actionErr("FEATURE_DISABLED", "Day pages are disabled.");
  }
  const parsed = saveDayEntrySchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid day entry."
    );
  }
  if (
    (parsed.data.energy !== undefined || parsed.data.sleepHours !== undefined) &&
    !isFeatureEnabled("energySleepInput")
  ) {
    return actionErr("FEATURE_DISABLED", "Energy and sleep inputs are disabled.");
  }

  try {
    const { user } = await requireSession();
    const saved = await habitService.saveDayEntry(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk({ dateKey: saved.date });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function listHabitSavedViewsAction(): Promise<
  ActionResult<HabitSavedView[]>
> {
  if (!isFeatureEnabled("savedViews")) {
    return actionErr("FEATURE_DISABLED", "Saved views are disabled.");
  }
  try {
    const { user } = await requireSession();
    return actionOk(await habitService.listHabitSavedViews(user.id));
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function createHabitSavedViewAction(
  input: z.input<typeof createSavedViewSchema>
): Promise<ActionResult<HabitSavedView>> {
  if (!isFeatureEnabled("savedViews")) {
    return actionErr("FEATURE_DISABLED", "Saved views are disabled.");
  }
  const parsed = createSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid saved view."
    );
  }

  try {
    const { user } = await requireSession();
    const created = await habitService.createHabitSavedView(
      user.id,
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateHabitSavedViewAction(
  input: z.input<typeof updateSavedViewSchema>
): Promise<ActionResult<HabitSavedView>> {
  if (!isFeatureEnabled("savedViews")) {
    return actionErr("FEATURE_DISABLED", "Saved views are disabled.");
  }
  const parsed = updateSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid saved view update."
    );
  }

  try {
    const { user } = await requireSession();
    const { viewId, ...patch } = parsed.data;
    const updated = await habitService.updateHabitSavedView(
      user.id,
      viewId,
      patch
    );
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteHabitSavedViewAction(
  input: z.input<typeof deleteSavedViewSchema>
): Promise<ActionResult<{ viewId: string }>> {
  if (!isFeatureEnabled("savedViews")) {
    return actionErr("FEATURE_DISABLED", "Saved views are disabled.");
  }
  const parsed = deleteSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid saved view identifier.");
  }

  try {
    const { user } = await requireSession();
    await habitService.deleteHabitSavedView(user.id, parsed.data.viewId);
    revalidateHabitPaths();
    return actionOk({ viewId: parsed.data.viewId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateHabitSettingsAction(
  input: z.input<typeof updateHabitSettingsSchema>
): Promise<ActionResult<ClientHabitTrackerSettings>> {
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
      parsed.data.rawText,
      parsed.data.targetYearMonth
    );
    revalidateHabitPaths();
    return actionOk({ importedCount: created.length, habits: created });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function saveHabitMonthRosterAction(
  input: z.input<typeof saveMonthRosterSchema>
): Promise<ActionResult<{ yearMonth: string; habitIds: string[] }>> {
  const parsed = saveMonthRosterSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid month roster."
    );
  }

  try {
    const { user } = await requireSession();
    const saved = await habitService.saveMonthRoster(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(saved);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function carryOverHabitMonthRosterAction(
  input: z.input<typeof carryOverMonthRosterSchema>
): Promise<
  ActionResult<{
    targetYearMonth: string;
    sourceYearMonth: string;
    habitIds: string[];
  }>
> {
  const parsed = carryOverMonthRosterSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid carry-over request."
    );
  }

  try {
    const { user } = await requireSession();
    const carried = await habitService.carryOverPreviousMonthRoster(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(carried);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function removeHabitFromMonthAction(
  input: z.input<typeof removeHabitFromMonthSchema>
): Promise<ActionResult<{ yearMonth: string; removedHabitId: string }>> {
  const parsed = removeHabitFromMonthSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid request."
    );
  }

  try {
    const { user } = await requireSession();
    const removed = await habitService.removeHabitFromMonth(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(removed);
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
    const rate = await defaultRateLimiter.limit("habit_history_import", user.id);
    if (!rate.allowed) {
      throw new RateLimitError({
        message: `Import rate limit reached. Please retry in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        limit: rate.limit,
        remaining: rate.remaining,
        resetAtMs: rate.resetAtMs,
      });
    }
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
        allowAutoLockedBackfill: parsed.data.allowAutoLockedBackfill,
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

export async function lockHabitMonthAction(
  input: z.input<typeof lockHabitMonthSchema>
): Promise<ActionResult<MonthLockState>> {
  const parsed = lockHabitMonthSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid month."
    );
  }

  try {
    const { user } = await requireSession();
    const state = await habitService.lockMonth(
      user.id,
      user.timezone || "UTC",
      parsed.data.yearMonth
    );
    revalidateHabitPaths();
    return actionOk(state);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function unlockHabitMonthAction(
  input: z.input<typeof unlockHabitMonthSchema>
): Promise<ActionResult<MonthLockState>> {
  const parsed = unlockHabitMonthSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid unlock request."
    );
  }

  try {
    const { user } = await requireSession();
    const state = await habitService.unlockMonth(
      user.id,
      user.timezone || "UTC",
      parsed.data
    );
    revalidateHabitPaths();
    return actionOk(state);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function setHabitMonthLockPinAction(
  input: z.input<typeof setMonthLockPinSchema>
): Promise<ActionResult<ClientHabitTrackerSettings>> {
  const parsed = setMonthLockPinSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid PIN."
    );
  }

  try {
    const { user } = await requireSession();
    const updated = await habitService.setMonthLockPin(user.id, parsed.data);
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function removeHabitMonthLockPinAction(
  input: z.input<typeof removeMonthLockPinSchema>
): Promise<ActionResult<ClientHabitTrackerSettings>> {
  const parsed = removeMonthLockPinSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Enter your current PIN."
    );
  }

  try {
    const { user } = await requireSession();
    const updated = await habitService.removeMonthLockPin(user.id, parsed.data);
    revalidateHabitPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
