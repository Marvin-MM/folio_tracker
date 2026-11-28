import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("push_subscriptions_user_id_idx").on(table.userId)]
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("notifications_user_read_created_idx").on(
      table.userId,
      table.isRead,
      table.createdAt
    ),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_user_type_entity_idx").on(
      table.userId,
      table.type,
      table.entityId
    ),
    index("notifications_is_read_idx").on(table.isRead),
    uniqueIndex("notifications_dedup_system_uq")
      .on(table.userId, table.type, table.entityId)
      .where(
        sql`${table.entityId} IS NOT NULL AND ${table.type} IN ('habit.nudge', 'habit.review_open', 'operation_stale')`
      ),
  ]
);

export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRecord = typeof pushSubscriptions.$inferInsert;
export type NotificationRecord = typeof notifications.$inferSelect;
export type NewNotificationRecord = typeof notifications.$inferInsert;
