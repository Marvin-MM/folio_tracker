import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";

/**
 * Phase A foundation: pause/excuse ranges. A range can cover all habits or a subset.
 * Effective status resolution must treat covered dates as skipped/excused (neutral).
 */
export const habitExcuseRanges = sqliteTable(
  "habit_excuse_ranges",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    reason: text("reason").notNull(),
    habitIdsJson: text("habit_ids_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (table) => [
    index("habit_excuse_ranges_user_dates_idx").on(
      table.userId,
      table.startDate,
      table.endDate
    ),
    index("habit_excuse_ranges_user_deleted_idx").on(
      table.userId,
      table.deletedAt
    ),
    check(
      "habit_excuse_ranges_date_order_check",
      sql`${table.startDate} <= ${table.endDate}`
    ),
  ]
);

export const habitDayEntries = sqliteTable(
  "habit_day_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    energy: integer("energy", { mode: "number" }),
    sleepHours: real("sleep_hours"),
    note: text("note"),
    journalPromptId: text("journal_prompt_id"),
    journalText: text("journal_text"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("habit_day_entries_user_date_uq").on(table.userId, table.date),
    index("habit_day_entries_user_deleted_idx").on(
      table.userId,
      table.deletedAt
    ),
    check(
      "habit_day_entries_energy_check",
      sql`${table.energy} IS NULL OR (${table.energy} >= 1 AND ${table.energy} <= 10)`
    ),
    check(
      "habit_day_entries_sleep_hours_check",
      sql`${table.sleepHours} IS NULL OR (${table.sleepHours} >= 0 AND ${table.sleepHours} <= 24)`
    ),
  ]
);

export const undoSnapshots = sqliteTable(
  "undo_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("undo_snapshots_user_expiry_idx").on(table.userId, table.expiresAt),
  ]
);

export type HabitExcuseRangeRecord = typeof habitExcuseRanges.$inferSelect;
export type NewHabitExcuseRangeRecord = typeof habitExcuseRanges.$inferInsert;
export type HabitDayEntryRecord = typeof habitDayEntries.$inferSelect;
export type NewHabitDayEntryRecord = typeof habitDayEntries.$inferInsert;
export type UndoSnapshotRecord = typeof undoSnapshots.$inferSelect;
export type NewUndoSnapshotRecord = typeof undoSnapshots.$inferInsert;
