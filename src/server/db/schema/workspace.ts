import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";
import { habits } from "./habits";

export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const INVITATION_ROLES = ["editor", "viewer"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "archived",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["none", "low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const projects = sqliteTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    colorToken: text("color_token").notNull().default("collab"),
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
    index("projects_owner_archived_idx").on(table.ownerId, table.isArchived),
  ]
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    joinedAt: integer("joined_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_id_idx").on(table.userId),
    check(
      "project_members_role_check",
      sql`${table.role} IN ('owner', 'editor', 'viewer')`
    ),
  ]
);

export const projectInvitations = sqliteTable(
  "project_invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: INVITATION_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: INVITATION_STATUSES })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("project_invitations_project_status_idx").on(
      table.projectId,
      table.status
    ),
    index("project_invitations_email_status_idx").on(table.email, table.status),
    check(
      "project_invitations_role_check",
      sql`${table.role} IN ('editor', 'viewer')`
    ),
    check(
      "project_invitations_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'revoked', 'expired')`
    ),
  ]
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    habitId: text("habit_id").references((): AnySQLiteColumn => habits.id, {
      onDelete: "set null",
    }),
    habitDateKey: text("habit_date_key"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: TASK_PRIORITIES })
      .notNull()
      .default("none"),
    dueAt: integer("due_at", { mode: "number" }),
    position: text("position").notNull().default("a0"),
    completedAt: integer("completed_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("tasks_user_status_due_idx").on(
      table.userId,
      table.status,
      table.dueAt
    ),
    index("tasks_project_status_position_idx").on(
      table.projectId,
      table.status,
      table.position
    ),
    index("tasks_assignee_status_idx").on(table.assigneeId, table.status),
    index("tasks_habit_date_idx").on(table.habitId, table.habitDateKey),
    check(
      "tasks_status_check",
      sql`${table.status} IN ('todo', 'in_progress', 'done', 'archived')`
    ),
    check(
      "tasks_priority_check",
      sql`${table.priority} IN ('none', 'low', 'medium', 'high')`
    ),
  ]
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    tagsJson: text("tags_json").notNull().default("[]"),
    isPinned: integer("is_pinned", { mode: "boolean" })
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
    index("notes_user_pinned_updated_idx").on(
      table.userId,
      table.isPinned,
      table.updatedAt
    ),
    index("notes_project_updated_idx").on(table.projectId, table.updatedAt),
  ]
);

export const projectActivities = sqliteTable(
  "project_activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("project_activities_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
  ]
);

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProjectRecord = typeof projects.$inferInsert;
export type ProjectMemberRecord = typeof projectMembers.$inferSelect;
export type ProjectInvitationRecord = typeof projectInvitations.$inferSelect;
export type TaskRecord = typeof tasks.$inferSelect;
export type NewTaskRecord = typeof tasks.$inferInsert;
export type NoteRecord = typeof notes.$inferSelect;
export type NewNoteRecord = typeof notes.$inferInsert;
export type ProjectActivityRecord = typeof projectActivities.$inferSelect;
