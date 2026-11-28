import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
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
import { HABIT_COMMENT_MODES, habits } from "./habits";

export const HABIT_MONITOR_SCOPES = ["all", "selected"] as const;
export type HabitMonitorScope = (typeof HABIT_MONITOR_SCOPES)[number];

export const HABIT_MONITOR_STATUSES = ["active", "revoked"] as const;
export type HabitMonitorStatus = (typeof HABIT_MONITOR_STATUSES)[number];

export const HABIT_MONITOR_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export type HabitMonitorRequestStatus =
  (typeof HABIT_MONITOR_REQUEST_STATUSES)[number];

export const HABIT_REACTION_TYPES = ["ack", "solid", "push"] as const;
export type HabitReactionType = (typeof HABIT_REACTION_TYPES)[number];

export const habitMonitors = sqliteTable(
  "habit_monitors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    monitorUserId: text("monitor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: HABIT_MONITOR_SCOPES })
      .notNull()
      .default("all"),
    status: text("status", { enum: HABIT_MONITOR_STATUSES })
      .notNull()
      .default("active"),
    useCustomPolicy: integer("use_custom_policy", { mode: "boolean" })
      .notNull()
      .default(false),
    customCommentMode: text("custom_comment_mode", {
      enum: HABIT_COMMENT_MODES,
    }),
    customWindowStartDay: integer("custom_window_start_day", {
      mode: "number",
    }),
    customWindowStartTime: text("custom_window_start_time"),
    customWindowEndDay: integer("custom_window_end_day", { mode: "number" }),
    customWindowEndTime: text("custom_window_end_time"),
    customIntervalDays: integer("custom_interval_days", { mode: "number" }),
    customIntervalAnchorDate: text("custom_interval_anchor_date"),
    customIntervalOpenHours: integer("custom_interval_open_hours", {
      mode: "number",
    }),
    customAllowReactionsWhenLocked: integer(
      "custom_allow_reactions_when_locked",
      { mode: "boolean" }
    ),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    revokedAt: integer("revoked_at", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("habit_monitors_owner_monitor_uq").on(
      table.ownerId,
      table.monitorUserId
    ),
    index("habit_monitors_monitor_status_idx").on(
      table.monitorUserId,
      table.status
    ),
    index("habit_monitors_owner_status_idx").on(table.ownerId, table.status),
    index("habit_monitors_status_id_idx").on(table.status, table.id),
    check(
      "habit_monitors_no_self_check",
      sql`${table.ownerId} != ${table.monitorUserId}`
    ),
    check(
      "habit_monitors_scope_check",
      sql`${table.scope} IN ('all', 'selected')`
    ),
    check(
      "habit_monitors_status_check",
      sql`${table.status} IN ('active', 'revoked')`
    ),
    check(
      "habit_monitors_custom_mode_check",
      sql`${table.customCommentMode} IS NULL OR ${table.customCommentMode} IN ('weekly_window', 'interval_days', 'anytime')`
    ),
    check(
      "habit_monitors_custom_start_day_check",
      sql`${table.customWindowStartDay} IS NULL OR (${table.customWindowStartDay} >= 0 AND ${table.customWindowStartDay} <= 6)`
    ),
    check(
      "habit_monitors_custom_end_day_check",
      sql`${table.customWindowEndDay} IS NULL OR (${table.customWindowEndDay} >= 0 AND ${table.customWindowEndDay} <= 6)`
    ),
    check(
      "habit_monitors_custom_interval_days_check",
      sql`${table.customIntervalDays} IS NULL OR (${table.customIntervalDays} >= 2 AND ${table.customIntervalDays} <= 30)`
    ),
    check(
      "habit_monitors_custom_open_hours_check",
      sql`${table.customIntervalOpenHours} IS NULL OR (${table.customIntervalOpenHours} >= 1 AND ${table.customIntervalOpenHours} <= 168)`
    ),
  ]
);

export const habitMonitorItems = sqliteTable(
  "habit_monitor_items",
  {
    monitorId: text("monitor_id")
      .notNull()
      .references(() => habitMonitors.id, { onDelete: "cascade" }),
    habitId: text("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.monitorId, table.habitId],
      name: "habit_monitor_items_pk",
    }),
    index("habit_monitor_items_habit_idx").on(table.habitId),
  ]
);

export const habitMonitorRequests = sqliteTable(
  "habit_monitor_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetEmail: text("target_email").notNull(),
    tokenHash: text("token_hash"),
    scope: text("scope", { enum: HABIT_MONITOR_SCOPES })
      .notNull()
      .default("all"),
    selectedHabitIdsJson: text("selected_habit_ids_json")
      .notNull()
      .default("[]"),
    proposedPolicyJson: text("proposed_policy_json"),
    status: text("status", { enum: HABIT_MONITOR_REQUEST_STATUSES })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    respondedAt: integer("responded_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("habit_monitor_requests_token_hash_uq").on(table.tokenHash),
    index("habit_monitor_requests_target_user_status_idx").on(
      table.targetUserId,
      table.status
    ),
    index("habit_monitor_requests_owner_status_idx").on(
      table.ownerId,
      table.status
    ),
    index("habit_monitor_requests_target_email_status_idx").on(
      table.targetEmail,
      table.status
    ),
    index("habit_monitor_requests_status_expires_idx").on(
      table.status,
      table.expiresAt
    ),
    check(
      "habit_monitor_requests_scope_check",
      sql`${table.scope} IN ('all', 'selected')`
    ),
    check(
      "habit_monitor_requests_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`
    ),
    check(
      "habit_monitor_requests_no_self_check",
      sql`${table.targetUserId} IS NULL OR ${table.targetUserId} != ${table.ownerId}`
    ),
  ]
);

export const habitWeeklySnapshots = sqliteTable(
  "habit_weekly_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cycleKey: text("cycle_key").notNull(),
    periodStartDate: text("period_start_date").notNull(),
    periodEndDate: text("period_end_date").notNull(),
    metricsJson: text("metrics_json").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("habit_weekly_snapshots_owner_cycle_uq").on(
      table.ownerId,
      table.cycleKey
    ),
  ]
);

export const habitComments = sqliteTable(
  "habit_comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cycleKey: text("cycle_key").notNull(),
    targetDateKey: text("target_date_key"),
    targetHabitId: text("target_habit_id").references(() => habits.id, {
      onDelete: "set null",
    }),
    parentCommentId: text("parent_comment_id").references(
      (): AnySQLiteColumn => habitComments.id,
      { onDelete: "cascade" }
    ),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("habit_comments_owner_cycle_created_idx").on(
      table.ownerId,
      table.cycleKey,
      table.createdAt
    ),
    index("habit_comments_parent_idx").on(table.parentCommentId),
    index("habit_comments_target_habit_idx").on(table.targetHabitId),
    index("habit_comments_author_id_idx").on(table.authorId),
    index("habit_comments_owner_created_idx").on(table.ownerId, table.createdAt),
  ]
);

export const habitReactions = sqliteTable(
  "habit_reactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cycleKey: text("cycle_key").notNull(),
    targetDateKey: text("target_date_key"),
    reactionType: text("reaction_type", {
      enum: HABIT_REACTION_TYPES,
    }).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("habit_reactions_day_uq")
      .on(
        table.ownerId,
        table.authorId,
        table.cycleKey,
        table.targetDateKey,
        table.reactionType
      )
      .where(sql`${table.targetDateKey} IS NOT NULL`),
    uniqueIndex("habit_reactions_cycle_uq")
      .on(table.ownerId, table.authorId, table.cycleKey, table.reactionType)
      .where(sql`${table.targetDateKey} IS NULL`),
    index("habit_reactions_owner_cycle_idx").on(table.ownerId, table.cycleKey),
    index("habit_reactions_author_id_idx").on(table.authorId),
    check(
      "habit_reactions_type_check",
      sql`${table.reactionType} IN ('ack', 'solid', 'push')`
    ),
  ]
);

export type HabitMonitorRecord = typeof habitMonitors.$inferSelect;
export type NewHabitMonitorRecord = typeof habitMonitors.$inferInsert;
export type HabitMonitorItemRecord = typeof habitMonitorItems.$inferSelect;
export type HabitMonitorRequestRecord =
  typeof habitMonitorRequests.$inferSelect;
export type HabitWeeklySnapshotRecord =
  typeof habitWeeklySnapshots.$inferSelect;
export type HabitCommentRecord = typeof habitComments.$inferSelect;
export type HabitReactionRecord = typeof habitReactions.$inferSelect;
