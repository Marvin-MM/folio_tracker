import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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
