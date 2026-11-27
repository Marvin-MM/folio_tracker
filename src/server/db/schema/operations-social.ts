import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";
import { operations } from "./operations";

export const OPERATION_MEMBER_ROLES = ["collaborator", "viewer"] as const;
export type OperationMemberRole = (typeof OPERATION_MEMBER_ROLES)[number];

export const OPERATION_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export type OperationInvitationStatus =
  (typeof OPERATION_INVITATION_STATUSES)[number];

export const OPERATION_STEP_FLAG_STATUSES = ["open", "resolved"] as const;
export type OperationStepFlagStatus =
  (typeof OPERATION_STEP_FLAG_STATUSES)[number];

export const userFollows = sqliteTable(
  "user_follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: text("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index("user_follows_following_created_idx").on(
      table.followingId,
      table.createdAt
    ),
    index("user_follows_follower_created_idx").on(
      table.followerId,
      table.createdAt
    ),
    check(
      "user_follows_no_self_follow_check",
      sql`${table.followerId} != ${table.followingId}`
    ),
  ]
);

export const operationMembers = sqliteTable(
  "operation_members",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: OPERATION_MEMBER_ROLES }).notNull(),
    grantedById: text("granted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.userId] }),
    index("operation_members_user_role_idx").on(table.userId, table.role),
    check(
      "operation_members_role_check",
      sql`${table.role} IN ('collaborator', 'viewer')`
    ),
  ]
);

export const operationInvitations = sqliteTable(
  "operation_invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetEmail: text("target_email").notNull(),
    tokenHash: text("token_hash").unique(),
    role: text("role", { enum: OPERATION_MEMBER_ROLES }).notNull(),
    status: text("status", { enum: OPERATION_INVITATION_STATUSES })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    respondedAt: integer("responded_at", { mode: "number" }),
  },
  (table) => [
    index("operation_invitations_target_user_status_idx").on(
      table.targetUserId,
      table.status
    ),
    index("operation_invitations_operation_status_idx").on(
      table.operationId,
      table.status
    ),
    index("operation_invitations_target_email_status_idx").on(
      table.targetEmail,
      table.status
    ),
    check(
      "operation_invitations_role_check",
      sql`${table.role} IN ('collaborator', 'viewer')`
    ),
    check(
      "operation_invitations_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`
    ),
  ]
);

export const operationStepFlags = sqliteTable(
  "operation_step_flags",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number", { mode: "number" }).notNull(),
    stepKey: text("step_key").notNull(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    status: text("status", { enum: OPERATION_STEP_FLAG_STATUSES })
      .notNull()
      .default("open"),
    resolvedById: text("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolved_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("operation_step_flags_op_status_created_idx").on(
      table.operationId,
      table.status,
      table.createdAt
    ),
    check(
      "operation_step_flags_status_check",
      sql`${table.status} IN ('open', 'resolved')`
    ),
    check(
      "operation_step_flags_version_check",
      sql`${table.versionNumber} >= 1`
    ),
  ]
);

export type UserFollowRecord = typeof userFollows.$inferSelect;
export type OperationMemberRecord = typeof operationMembers.$inferSelect;
export type OperationInvitationRecord = typeof operationInvitations.$inferSelect;
export type OperationStepFlagRecord = typeof operationStepFlags.$inferSelect;
