import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";
import { users } from "./auth";
import { habits } from "./habits";
import { notes, projects } from "./workspace";

export const OPERATION_DOMAINS = [
  "general",
  "tech",
  "cooking",
  "fitness",
  "diy",
  "business",
  "study",
] as const;
export type OperationDomain = (typeof OPERATION_DOMAINS)[number];

export const OPERATION_DIFFICULTIES = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type OperationDifficulty = (typeof OPERATION_DIFFICULTIES)[number];

export const OPERATION_VISIBILITIES = [
  "private",
  "unlisted",
  "public",
] as const;
export type OperationVisibility = (typeof OPERATION_VISIBILITIES)[number];

export const OPERATION_RUN_STATUSES = [
  "in_progress",
  "completed",
  "abandoned",
] as const;
export type OperationRunStatus = (typeof OPERATION_RUN_STATUSES)[number];

export const OPERATION_RUN_STEP_STATUSES = [
  "pending",
  "done",
  "skipped",
  "blocked",
] as const;
export type OperationRunStepStatus = (typeof OPERATION_RUN_STEP_STATUSES)[number];

export const operations = sqliteTable(
  "operations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    linkedHabitId: text("linked_habit_id").references(() => habits.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    domain: text("domain", { enum: OPERATION_DOMAINS })
      .notNull()
      .default("general"),
    tagsJson: text("tags_json").notNull().default("[]"),
    difficulty: text("difficulty", { enum: OPERATION_DIFFICULTIES }),
    estimatedMinutes: integer("estimated_minutes", { mode: "number" }),
    visibility: text("visibility", { enum: OPERATION_VISIBILITIES })
      .notNull()
      .default("private"),
    unlistedTokenHash: text("unlisted_token_hash").unique(),
    allowForking: integer("allow_forking", { mode: "boolean" })
      .notNull()
      .default(true),
    shareWithProject: integer("share_with_project", { mode: "boolean" })
      .notNull()
      .default(false),
    currentVersion: integer("current_version", { mode: "number" })
      .notNull()
      .default(1),
    editVersion: integer("edit_version", { mode: "number" })
      .notNull()
      .default(1),
    forkedFromId: text("forked_from_id").references(
      (): AnySQLiteColumn => operations.id,
      { onDelete: "set null" }
    ),
    forkCount: integer("fork_count", { mode: "number" }).notNull().default(0),
    reviewCycleDays: integer("review_cycle_days", { mode: "number" }),
    lastVerifiedAt: integer("last_verified_at", { mode: "number" }),
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
    index("operations_owner_archived_updated_idx").on(
      table.ownerId,
      table.isArchived,
      table.updatedAt
    ),
    index("operations_visibility_domain_updated_idx").on(
      table.visibility,
      table.domain,
      table.updatedAt
    ),
    index("operations_project_id_idx").on(table.projectId),
    index("operations_linked_habit_id_idx").on(table.linkedHabitId),
    check(
      "operations_domain_check",
      sql`${table.domain} IN ('general', 'tech', 'cooking', 'fitness', 'diy', 'business', 'study')`
    ),
    check(
      "operations_difficulty_check",
      sql`${table.difficulty} IS NULL OR ${table.difficulty} IN ('beginner', 'intermediate', 'advanced')`
    ),
    check(
      "operations_visibility_check",
      sql`${table.visibility} IN ('private', 'unlisted', 'public')`
    ),
    check(
      "operations_current_version_check",
      sql`${table.currentVersion} >= 1`
    ),
    check("operations_edit_version_check", sql`${table.editVersion} >= 1`),
    check("operations_fork_count_check", sql`${table.forkCount} >= 0`),
    check(
      "operations_estimated_minutes_check",
      sql`${table.estimatedMinutes} IS NULL OR ${table.estimatedMinutes} >= 1`
    ),
    check(
      "operations_review_cycle_days_check",
      sql`${table.reviewCycleDays} IS NULL OR ${table.reviewCycleDays} >= 1`
    ),
  ]
);

export const operationVersions = sqliteTable(
  "operation_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number", { mode: "number" }).notNull(),
    variablesSchemaJson: text("variables_schema_json").notNull().default("[]"),
    prerequisitesJson: text("prerequisites_json").notNull().default("[]"),
    stepsSnapshotJson: text("steps_snapshot_json").notNull().default("[]"),
    changeSummary: text("change_summary"),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("operation_versions_operation_version_uidx").on(
      table.operationId,
      table.versionNumber
    ),
    check(
      "operation_versions_version_number_check",
      sql`${table.versionNumber} >= 1`
    ),
  ]
);

export const operationReferenceNotes = sqliteTable(
  "operation_reference_notes",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.noteId] }),
    index("operation_reference_notes_note_id_idx").on(table.noteId),
  ]
);

export const operationRuns = sqliteTable(
  "operation_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => operationVersions.id, { onDelete: "cascade" }),
    runnerId: text("runner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: OPERATION_RUN_STATUSES })
      .notNull()
      .default("in_progress"),
    variablesValuesJson: text("variables_values_json").notNull().default("{}"),
    prerequisitesCheckedJson: text("prerequisites_checked_json")
      .notNull()
      .default("[]"),
    startedAt: integer("started_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    completedAt: integer("completed_at", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("operation_runs_runner_status_updated_idx").on(
      table.runnerId,
      table.status,
      table.updatedAt
    ),
    index("operation_runs_operation_runner_idx").on(
      table.operationId,
      table.runnerId
    ),
    check(
      "operation_runs_status_check",
      sql`${table.status} IN ('in_progress', 'completed', 'abandoned')`
    ),
  ]
);

export const operationRunSteps = sqliteTable(
  "operation_run_steps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    runId: text("run_id")
      .notNull()
      .references(() => operationRuns.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    status: text("status", { enum: OPERATION_RUN_STEP_STATUSES })
      .notNull()
      .default("pending"),
    note: text("note"),
    completedAt: integer("completed_at", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    uniqueIndex("operation_run_steps_run_step_key_uidx").on(
      table.runId,
      table.stepKey
    ),
    check(
      "operation_run_steps_status_check",
      sql`${table.status} IN ('pending', 'done', 'skipped', 'blocked')`
    ),
  ]
);

export type OperationRecord = typeof operations.$inferSelect;
export type NewOperationRecord = typeof operations.$inferInsert;
export type OperationVersionRecord = typeof operationVersions.$inferSelect;
export type NewOperationVersionRecord = typeof operationVersions.$inferInsert;
export type OperationReferenceNoteRecord =
  typeof operationReferenceNotes.$inferSelect;
export type OperationRunRecord = typeof operationRuns.$inferSelect;
export type NewOperationRunRecord = typeof operationRuns.$inferInsert;
export type OperationRunStepRecord = typeof operationRunSteps.$inferSelect;
export type NewOperationRunStepRecord = typeof operationRunSteps.$inferInsert;
