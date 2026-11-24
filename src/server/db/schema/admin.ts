import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";

export const ADMIN_AUDIT_TARGET_TYPES = [
  "system",
  "user",
  "reminder",
  "invitation",
  "project",
] as const;

export type AdminAuditTargetType = (typeof ADMIN_AUDIT_TARGET_TYPES)[number];

/**
 * Append-only operational audit trail for all platform admin actions
 * and automated ADMIN_EMAILS role synchronization transitions.
 */
export const adminAuditLogs = sqliteTable(
  "admin_audit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type", { enum: ADMIN_AUDIT_TARGET_TYPES })
      .notNull()
      .default("system"),
    targetId: text("target_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("admin_audit_logs_created_idx").on(table.createdAt),
    index("admin_audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
  ]
);

export type AdminAuditLogRecord = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLogRecord = typeof adminAuditLogs.$inferInsert;
