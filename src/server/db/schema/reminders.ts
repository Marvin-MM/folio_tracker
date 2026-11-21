import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";
import { notes, tasks } from "./workspace";

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
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    noteId: text("note_id").references(() => notes.id, { onDelete: "cascade" }),
    remindAt: integer("remind_at", { mode: "number" }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status", { enum: REMINDER_STATUSES })
      .notNull()
      .default("scheduled"),
    version: integer("version", { mode: "number" }).notNull().default(1),
    dispatchedAt: integer("dispatched_at", { mode: "number" }),
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
    index("reminders_outbox_idx").on(
      table.status,
      table.dispatchedAt,
      table.updatedAt
    ),
    index("reminders_task_id_idx").on(table.taskId),
    index("reminders_note_id_idx").on(table.noteId),
    index("reminders_user_status_remind_at_idx").on(
      table.userId,
      table.status,
      table.remindAt
    ),
    check(
      "reminders_target_xor_check",
      sql`((${table.taskId} IS NOT NULL AND ${table.noteId} IS NULL) OR (${table.taskId} IS NULL AND ${table.noteId} IS NOT NULL))`
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

export type ReminderTarget =
  | { taskId: string; noteId?: null }
  | { noteId: string; taskId?: null };

/**
 * Pure derived discriminator helper over the mutually-exclusive `taskId` / `noteId`
 * foreign keys so UI and notification payloads can format entity metadata cleanly.
 */
export function getReminderTarget(
  reminder: Pick<ReminderRecord, "taskId" | "noteId">
): { entityType: ReminderEntityType; entityId: string } {
  if (reminder.taskId) {
    return { entityType: "task", entityId: reminder.taskId };
  }
  if (reminder.noteId) {
    return { entityType: "note", entityId: reminder.noteId };
  }
  throw new Error("Invalid reminder record: missing both taskId and noteId.");
}
