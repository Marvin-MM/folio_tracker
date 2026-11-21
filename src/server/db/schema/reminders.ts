import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";

export const REMINDER_ENTITY_TYPES = ["task", "note"] as const;
export type ReminderEntityType = (typeof REMINDER_ENTITY_TYPES)[number];

export const REMINDER_STATUSES = [
  "pending_far",
  "scheduled",
  "sent",
  "snoozed",
  "cancelled",
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: REMINDER_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    remindAt: integer("remind_at", { mode: "number" }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status", { enum: REMINDER_STATUSES })
      .notNull()
      .default("scheduled"),
    version: integer("version", { mode: "number" }).notNull().default(1),
    sentAt: integer("sent_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("reminders_status_remind_at_idx").on(table.status, table.remindAt),
    index("reminders_entity_idx").on(table.entityType, table.entityId),
    index("reminders_user_status_remind_at_idx").on(
      table.userId,
      table.status,
      table.remindAt
    ),
    check(
      "reminders_entity_type_check",
      sql`${table.entityType} IN ('task', 'note')`
    ),
    check(
      "reminders_status_check",
      sql`${table.status} IN ('pending_far', 'scheduled', 'sent', 'snoozed', 'cancelled')`
    ),
    check("reminders_version_check", sql`${table.version} >= 1`),
  ]
);

export type ReminderRecord = typeof reminders.$inferSelect;
export type NewReminderRecord = typeof reminders.$inferInsert;
