import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";
import { projects } from "./workspace";

export const HABIT_COMMENT_MODES = [
  "weekly_window",
  "interval_days",
  "anytime",
] as const;
export type HabitCommentMode = (typeof HABIT_COMMENT_MODES)[number];

export const HABIT_CADENCE_TYPES = [
  "daily",
  "specific_days",
  "weekly_target",
] as const;
export type HabitCadenceType = (typeof HABIT_CADENCE_TYPES)[number];

export const HABIT_LOG_STATUSES = ["done", "missed", "skipped"] as const;
export type HabitLogStatus = (typeof HABIT_LOG_STATUSES)[number];

export const HABIT_MONTH_LOCK_STATUSES = [
  "locked",
  "unlocked_override",
] as const;
export type HabitMonthLockStatus = (typeof HABIT_MONTH_LOCK_STATUSES)[number];

export const habitTrackerSettings = sqliteTable(
  "habit_tracker_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStartsOn: integer("week_starts_on", { mode: "number" })
      .notNull()
      .default(1),
    defaultCommentMode: text("default_comment_mode", {
      enum: HABIT_COMMENT_MODES,
    })
      .notNull()
      .default("weekly_window"),
    defaultWindowStartDay: integer("default_window_start_day", {
      mode: "number",
    })
      .notNull()
      .default(6),
    defaultWindowStartTime: text("default_window_start_time")
      .notNull()
      .default("00:00"),
    defaultWindowEndDay: integer("default_window_end_day", { mode: "number" })
      .notNull()
      .default(0),
    defaultWindowEndTime: text("default_window_end_time")
      .notNull()
      .default("23:59"),
    defaultIntervalDays: integer("default_interval_days", { mode: "number" }),
    defaultIntervalAnchorDate: text("default_interval_anchor_date"),
    defaultIntervalOpenHours: integer("default_interval_open_hours", {
      mode: "number",
    })
      .notNull()
      .default(24),
    allowReactionsWhenLocked: integer("allow_reactions_when_locked", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    eveningCheckinTime: text("evening_checkin_time"),
    /** Master switch for partner streak-risk nudges from accountability groups. */
    partnerNudgesEnabled: integer("partner_nudges_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Local hour (0-23) from which an unlogged streak is considered at risk. */
    partnerNudgeStartHour: integer("partner_nudge_start_hour", {
      mode: "number",
    })
      .notNull()
      .default(18),
    /** Minimum current streak worth protecting before partners are nudged. */
    partnerNudgeMinStreak: integer("partner_nudge_min_streak", {
      mode: "number",
    })
      .notNull()
      .default(2),
    /** Recipient quiet hours (HH:mm, inclusive start / exclusive end). */
    nudgeQuietHoursStart: text("nudge_quiet_hours_start")
      .notNull()
      .default("21:00"),
    nudgeQuietHoursEnd: text("nudge_quiet_hours_end")
      .notNull()
      .default("08:00"),
    monthLockEnabled: integer("month_lock_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    monthLockGraceDays: integer("month_lock_grace_days", { mode: "number" })
      .notNull()
      .default(3),
    monthLockPinHash: text("month_lock_pin_hash"),
    monthLockPinSalt: text("month_lock_pin_salt"),
    monthLockPinFailedAttempts: integer("month_lock_pin_failed_attempts", {
      mode: "number",
    })
      .notNull()
      .default(0),
    monthLockPinLockedUntil: integer("month_lock_pin_locked_until", {
      mode: "number",
    }),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    check(
      "habit_settings_week_starts_on_check",
      sql`${table.weekStartsOn} IN (0, 1)`
    ),
    check(
      "habit_settings_comment_mode_check",
      sql`${table.defaultCommentMode} IN ('weekly_window', 'interval_days', 'anytime')`
    ),
    check(
      "habit_settings_window_start_day_check",
      sql`${table.defaultWindowStartDay} >= 0 AND ${table.defaultWindowStartDay} <= 6`
    ),
    check(
      "habit_settings_window_end_day_check",
      sql`${table.defaultWindowEndDay} >= 0 AND ${table.defaultWindowEndDay} <= 6`
    ),
    check(
      "habit_settings_interval_days_check",
      sql`${table.defaultIntervalDays} IS NULL OR ${table.defaultIntervalDays} >= 1`
    ),
    check(
      "habit_settings_interval_open_hours_check",
      sql`${table.defaultIntervalOpenHours} >= 1`
    ),
    check(
      "habit_settings_partner_nudge_start_hour_check",
      sql`${table.partnerNudgeStartHour} >= 0 AND ${table.partnerNudgeStartHour} <= 23`
    ),
    check(
      "habit_settings_partner_nudge_min_streak_check",
      sql`${table.partnerNudgeMinStreak} >= 1 AND ${table.partnerNudgeMinStreak} <= 365`
    ),
    check(
      "habit_settings_month_lock_grace_days_check",
      sql`${table.monthLockGraceDays} >= 0 AND ${table.monthLockGraceDays} <= 14`
    ),
    check(
      "habit_settings_pin_failed_attempts_check",
      sql`${table.monthLockPinFailedAttempts} >= 0`
    ),
  ]
);

export const habits = sqliteTable(
  "habits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    cadenceType: text("cadence_type", { enum: HABIT_CADENCE_TYPES })
      .notNull()
      .default("daily"),
    scheduledDaysJson: text("scheduled_days_json").notNull().default("[]"),
    weeklyTargetCount: integer("weekly_target_count", { mode: "number" }),
    startDate: text("start_date").notNull(),
    preferredTime: text("preferred_time"),
    linkedProjectId: text("linked_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    autoSyncDailyTask: integer("auto_sync_daily_task", { mode: "boolean" })
      .notNull()
      .default(false),
    position: text("position").notNull().default("n"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("habits_user_archived_pos_idx").on(
      table.userId,
      table.isArchived,
      table.position
    ),
    index("habits_archived_preferred_time_idx").on(
      table.isArchived,
      table.preferredTime
    ),
    check(
      "habits_cadence_type_check",
      sql`${table.cadenceType} IN ('daily', 'specific_days', 'weekly_target')`
    ),
    check(
      "habits_weekly_target_check",
      sql`${table.weeklyTargetCount} IS NULL OR (${table.weeklyTargetCount} >= 1 AND ${table.weeklyTargetCount} <= 7)`
    ),
  ]
);

/**
 * Maps a source spreadsheet title to the canonical FOLIO habit it belongs to.
 * One habit can have many aliases (renames and merges), but a source title
 * resolves to exactly one habit per user.
 */
export const habitImportAliases = sqliteTable(
  "habit_import_aliases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    habitId: text("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    sourceTitle: text("source_title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    firstSeenDateKey: text("first_seen_date_key").notNull(),
    lastSeenDateKey: text("last_seen_date_key").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("habit_import_alias_user_title_uq").on(
      table.userId,
      table.normalizedTitle
    ),
    index("habit_import_alias_user_habit_idx").on(table.userId, table.habitId),
  ]
);

export type HabitImportAliasRecord = typeof habitImportAliases.$inferSelect;

/**
 * Per-month habit enrollment roster: records exactly which habits belong to a
 * given `year_month` (`YYYY-MM`) so each month renders its own curated habit
 * list and accurate monthly analytics while allowing carry-over & editing
 * between months without altering historical months.
 */
export const habitMonthRosters = sqliteTable(
  "habit_month_rosters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    habitId: text("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    yearMonth: text("year_month").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.habitId, table.yearMonth] }),
    index("habit_month_rosters_user_month_idx").on(
      table.userId,
      table.yearMonth
    ),
    index("habit_month_rosters_habit_idx").on(table.habitId, table.yearMonth),
  ]
);

export type HabitMonthRosterRecord = typeof habitMonthRosters.$inferSelect;

/**
 * Per-month lock override ledger: persists explicit manual locks, timed
 * temporary unlock windows (`unlocked_until`), and audit unlock counts per
 * `(user_id, year_month)` so historical consistency stays verifiable without
 * relying on background cron jobs.
 */
export const habitMonthLocks = sqliteTable(
  "habit_month_locks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    yearMonth: text("year_month").notNull(),
    status: text("status", { enum: HABIT_MONTH_LOCK_STATUSES })
      .notNull()
      .default("locked"),
    lockedAt: integer("locked_at", { mode: "number" }),
    unlockedAt: integer("unlocked_at", { mode: "number" }),
    unlockedUntil: integer("unlocked_until", { mode: "number" }),
    unlockReason: text("unlock_reason"),
    unlockCount: integer("unlock_count", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.yearMonth] }),
    index("habit_month_locks_user_month_idx").on(table.userId, table.yearMonth),
    check(
      "habit_month_locks_status_check",
      sql`${table.status} IN ('locked', 'unlocked_override')`
    ),
    check(
      "habit_month_locks_unlock_count_check",
      sql`${table.unlockCount} >= 0`
    ),
  ]
);

export type HabitMonthLockRecord = typeof habitMonthLocks.$inferSelect;
export type NewHabitMonthLockRecord = typeof habitMonthLocks.$inferInsert;

export const habitLogs = sqliteTable(
  "habit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    habitId: text("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dateKey: text("date_key").notNull(),
    status: text("status", { enum: HABIT_LOG_STATUSES }).notNull(),
    note: text("note"),
    loggedAt: integer("logged_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    isBackfilledLate: integer("is_backfilled_late", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("habit_logs_habit_date_uq").on(table.habitId, table.dateKey),
    index("habit_logs_user_date_idx").on(table.userId, table.dateKey),
    check(
      "habit_logs_status_check",
      sql`${table.status} IN ('done', 'missed', 'skipped')`
    ),
  ]
);

export type HabitTrackerSettingsRecord =
  typeof habitTrackerSettings.$inferSelect;
export type NewHabitTrackerSettingsRecord =
  typeof habitTrackerSettings.$inferInsert;
export type HabitRecord = typeof habits.$inferSelect;
export type NewHabitRecord = typeof habits.$inferInsert;
export type HabitLogRecord = typeof habitLogs.$inferSelect;
export type NewHabitLogRecord = typeof habitLogs.$inferInsert;
