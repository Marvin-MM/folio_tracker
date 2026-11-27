import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habits,
  notes,
  operationReferenceNotes,
  operationRuns,
  operationRunSteps,
  operations,
  operationVersions,
  projects,
  type OperationDifficulty,
  type OperationDomain,
  type OperationRecord,
  type OperationReferenceNoteRecord,
  type OperationRunRecord,
  type OperationRunStatus,
  type OperationRunStepRecord,
  type OperationRunStepStatus,
  type OperationVersionRecord,
  type OperationVisibility,
} from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

export type OperationAccessRole = "owner" | "editor" | "viewer";

export interface OperationAccessContext {
  operation: OperationRecord;
  role: OperationAccessRole;
}

/**
 * Direct-Turso tenant authorization guard for Operation Blueprints.
 * SECURITY INVARIANT: Never reads from Redis so visibility / ownership changes
 * take effect immediately with zero TTL window.
 *
 * Phase 1 enforces owner-only access (`ownerId === userId`) and keeps private
 * resources opaque (`NotFoundError`) so non-owners cannot enumerate IDs.
 * Designed cleanly for Phase 2 collaborator / public-view expansion.
 */
export async function assertOperationAccess(
  operationId: string,
  userId: string,
  allowedRoles: readonly OperationAccessRole[],
  executor: DbExecutor = db
): Promise<OperationAccessContext> {
  if (!operationId || !userId || allowedRoles.length === 0) {
    throw new ForbiddenError();
  }

  const [operation] = await executor
    .select()
    .from(operations)
    .where(eq(operations.id, operationId))
    .limit(1);

  if (!operation) {
    throw new NotFoundError("Operation not found.");
  }

  if (operation.ownerId === userId) {
    if (!allowedRoles.includes("owner")) {
      throw new ForbiddenError();
    }
    return { operation, role: "owner" };
  }

  throw new NotFoundError("Operation not found.");
}

export interface OperationReferenceNoteSummary {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: number;
}

export interface OperationListRow {
  operation: OperationRecord;
  projectName: string | null;
  projectColorToken: string | null;
  linkedHabitTitle: string | null;
  stepCount: number;
  activeRunsCount: number;
  totalRunsCount: number;
}

export interface OperationRunListRow {
  run: OperationRunRecord;
  operationTitle: string;
  operationDomain: OperationDomain;
  operationSlug: string;
  versionNumber: number;
  totalSteps: number;
  doneSteps: number;
  skippedSteps: number;
  blockedSteps: number;
}

export interface CreateOperationRowInput {
  ownerId: string;
  projectId?: string | null;
  linkedHabitId?: string | null;
  slug: string;
  title: string;
  summary: string;
  domain: OperationDomain;
  tagsJson: string;
  difficulty?: OperationDifficulty | null;
  estimatedMinutes?: number | null;
  visibility: OperationVisibility;
  unlistedTokenHash?: string | null;
  allowForking: boolean;
  reviewCycleDays?: number | null;
  lastVerifiedAt?: number | null;
  nowMs: number;
}

export interface OptimisticUpdateOperationInput {
  operationId: string;
  ownerId: string;
  expectedEditVersion: number;
  incrementCurrentVersion: boolean;
  patch: {
    projectId?: string | null;
    linkedHabitId?: string | null;
    title?: string;
    summary?: string;
    domain?: OperationDomain;
    tagsJson?: string;
    difficulty?: OperationDifficulty | null;
    estimatedMinutes?: number | null;
    visibility?: OperationVisibility;
    unlistedTokenHash?: string | null;
    allowForking?: boolean;
    reviewCycleDays?: number | null;
    lastVerifiedAt?: number | null;
  };
  nowMs: number;
}

export interface CreateOperationVersionRowInput {
  operationId: string;
  versionNumber: number;
  variablesSchemaJson: string;
  prerequisitesJson: string;
  stepsSnapshotJson: string;
  changeSummary?: string | null;
  createdById: string;
  nowMs: number;
}

export interface CreateOperationRunRowInput {
  operationId: string;
  versionId: string;
  runnerId: string;
  title: string;
  variablesValuesJson: string;
  prerequisitesCheckedJson: string;
  nowMs: number;
}

export interface OperationRepository {
  getById(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationRecord | null>;
  getByIdForOwner(
    operationId: string,
    ownerId: string,
    executor?: DbExecutor
  ): Promise<OperationRecord | null>;
  findBySlug(
    slug: string,
    executor?: DbExecutor
  ): Promise<Pick<OperationRecord, "id" | "slug"> | null>;
  listForOwner(
    ownerId: string,
    options?: { includeArchived?: boolean; domain?: OperationDomain },
    executor?: DbExecutor
  ): Promise<OperationListRow[]>;
  createOperation(
    input: CreateOperationRowInput,
    executor?: DbExecutor
  ): Promise<OperationRecord>;
  updateOperationWithOptimisticLock(
    input: OptimisticUpdateOperationInput,
    executor?: DbExecutor
  ): Promise<OperationRecord | null>;
  updateOperationSimple(
    operationId: string,
    ownerId: string,
    patch: Partial<
      Pick<
        OperationRecord,
        "isArchived" | "lastVerifiedAt" | "updatedAt"
      >
    >,
    executor?: DbExecutor
  ): Promise<OperationRecord | null>;
  deleteOperationForOwner(
    operationId: string,
    ownerId: string,
    executor?: DbExecutor
  ): Promise<boolean>;

  createVersion(
    input: CreateOperationVersionRowInput,
    executor?: DbExecutor
  ): Promise<OperationVersionRecord>;
  getLatestVersion(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationVersionRecord | null>;
  getVersionById(
    versionId: string,
    executor?: DbExecutor
  ): Promise<OperationVersionRecord | null>;
  getVersionByNumber(
    operationId: string,
    versionNumber: number,
    executor?: DbExecutor
  ): Promise<OperationVersionRecord | null>;
  listVersionsForOperation(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationVersionRecord[]>;

  listReferenceNotesForOperation(
    operationId: string,
    executor?: DbExecutor
  ): Promise<OperationReferenceNoteSummary[]>;
  replaceReferenceNotes(
    operationId: string,
    noteIds: string[],
    executor?: DbExecutor
  ): Promise<OperationReferenceNoteRecord[]>;

  createRun(
    input: CreateOperationRunRowInput,
    executor?: DbExecutor
  ): Promise<OperationRunRecord>;
  getRunByIdForRunner(
    runId: string,
    runnerId: string,
    executor?: DbExecutor
  ): Promise<OperationRunRecord | null>;
  listRunsForUser(
    runnerId: string,
    options?: {
      status?: OperationRunStatus;
      operationId?: string;
      limit?: number;
    },
    executor?: DbExecutor
  ): Promise<OperationRunListRow[]>;
  updateRunPreflight(
    runId: string,
    runnerId: string,
    patch: {
      title?: string;
      variablesValuesJson?: string;
      prerequisitesCheckedJson?: string;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<OperationRunRecord | null>;
  completeRunAtomically(
    runId: string,
    runnerId: string,
    completedAt: number,
    executor?: DbExecutor
  ): Promise<OperationRunRecord | null>;
  abandonRunAtomically(
    runId: string,
    runnerId: string,
    updatedAt: number,
    executor?: DbExecutor
  ): Promise<OperationRunRecord | null>;

  listRunSteps(
    runId: string,
    executor?: DbExecutor
  ): Promise<OperationRunStepRecord[]>;
  seedRunStepsBatch(
    runId: string,
    stepKeys: string[],
    nowMs: number,
    executor?: DbExecutor
  ): Promise<OperationRunStepRecord[]>;
  upsertRunStep(
    params: {
      runId: string;
      stepKey: string;
      status: OperationRunStepStatus;
      note?: string | null;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<OperationRunStepRecord>;
}

function countStepsFromJson(stepsSnapshotJson: string): number {
  try {
    const parsed: unknown = JSON.parse(stepsSnapshotJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export class DrizzleOperationRepository implements OperationRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async getById(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationRecord | null> {
    const [row] = await executor
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .limit(1);
    return row ?? null;
  }

  async getByIdForOwner(
    operationId: string,
    ownerId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationRecord | null> {
    const [row] = await executor
      .select()
      .from(operations)
      .where(
        and(eq(operations.id, operationId), eq(operations.ownerId, ownerId))
      )
      .limit(1);
    return row ?? null;
  }

  async findBySlug(
    slug: string,
    executor: DbExecutor = this.database
  ): Promise<Pick<OperationRecord, "id" | "slug"> | null> {
    const [row] = await executor
      .select({ id: operations.id, slug: operations.slug })
      .from(operations)
      .where(eq(operations.slug, slug))
      .limit(1);
    return row ?? null;
  }

  async listForOwner(
    ownerId: string,
    options: { includeArchived?: boolean; domain?: OperationDomain } = {},
    executor: DbExecutor = this.database
  ): Promise<OperationListRow[]> {
    const conditions = [eq(operations.ownerId, ownerId)];
    if (!options.includeArchived) {
      conditions.push(eq(operations.isArchived, false));
    }
    if (options.domain) {
      conditions.push(eq(operations.domain, options.domain));
    }

    const opRows = await executor
      .select()
      .from(operations)
      .where(and(...conditions))
      .orderBy(desc(operations.updatedAt), desc(operations.id))
      .limit(200);

    if (opRows.length === 0) return [];

    const opIds = opRows.map((o) => o.id);
    const projectIds = Array.from(
      new Set(
        opRows
          .map((o) => o.projectId)
          .filter((id): id is string => typeof id === "string")
      )
    );
    const habitIds = Array.from(
      new Set(
        opRows
          .map((o) => o.linkedHabitId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const [versionRows, runRows, projectRows, habitRows] = await Promise.all([
      executor
        .select({
          operationId: operationVersions.operationId,
          versionNumber: operationVersions.versionNumber,
          stepsSnapshotJson: operationVersions.stepsSnapshotJson,
        })
        .from(operationVersions)
        .where(inArray(operationVersions.operationId, opIds)),
      executor
        .select({
          operationId: operationRuns.operationId,
          status: operationRuns.status,
        })
        .from(operationRuns)
        .where(
          and(
            eq(operationRuns.runnerId, ownerId),
            inArray(operationRuns.operationId, opIds)
          )
        ),
      projectIds.length > 0
        ? executor
            .select({
              id: projects.id,
              name: projects.name,
              colorToken: projects.colorToken,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds))
        : Promise.resolve([]),
      habitIds.length > 0
        ? executor
            .select({
              id: habits.id,
              title: habits.title,
            })
            .from(habits)
            .where(inArray(habits.id, habitIds))
        : Promise.resolve([]),
    ]);

    const stepCountByOp = new Map<string, number>();
    const currentVersionByOp = new Map(
      opRows.map((o) => [o.id, o.currentVersion])
    );
    for (const ver of versionRows) {
      if (ver.versionNumber === currentVersionByOp.get(ver.operationId)) {
        stepCountByOp.set(
          ver.operationId,
          countStepsFromJson(ver.stepsSnapshotJson)
        );
      }
    }

    const activeRunsByOp = new Map<string, number>();
    const totalRunsByOp = new Map<string, number>();
    for (const run of runRows) {
      totalRunsByOp.set(
        run.operationId,
        (totalRunsByOp.get(run.operationId) ?? 0) + 1
      );
      if (run.status === "in_progress") {
        activeRunsByOp.set(
          run.operationId,
          (activeRunsByOp.get(run.operationId) ?? 0) + 1
        );
      }
    }

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));
    const habitMap = new Map(habitRows.map((h) => [h.id, h.title]));

    return opRows.map((operation) => {
      const project = operation.projectId
        ? projectMap.get(operation.projectId)
        : null;
      return {
        operation,
        projectName: project?.name ?? null,
        projectColorToken: project?.colorToken ?? null,
        linkedHabitTitle: operation.linkedHabitId
          ? (habitMap.get(operation.linkedHabitId) ?? null)
          : null,
        stepCount: stepCountByOp.get(operation.id) ?? 0,
        activeRunsCount: activeRunsByOp.get(operation.id) ?? 0,
        totalRunsCount: totalRunsByOp.get(operation.id) ?? 0,
      };
    });
  }

  async createOperation(
    input: CreateOperationRowInput,
    executor: DbExecutor = this.database
  ): Promise<OperationRecord> {
    const [created] = await executor
      .insert(operations)
      .values({
        ownerId: input.ownerId,
        projectId: input.projectId ?? null,
        linkedHabitId: input.linkedHabitId ?? null,
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        domain: input.domain,
        tagsJson: input.tagsJson,
        difficulty: input.difficulty ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        visibility: input.visibility,
        unlistedTokenHash: input.unlistedTokenHash ?? null,
        allowForking: input.allowForking,
        currentVersion: 1,
        editVersion: 1,
        forkCount: 0,
        reviewCycleDays: input.reviewCycleDays ?? null,
        lastVerifiedAt: input.lastVerifiedAt ?? null,
        isArchived: false,
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert operation.");
    }
    return created;
  }

  async updateOperationWithOptimisticLock(
    input: OptimisticUpdateOperationInput,
    executor: DbExecutor = this.database
  ): Promise<OperationRecord | null> {
    const setPayload: Record<string, unknown> = {
      ...input.patch,
      editVersion: sql`${operations.editVersion} + 1`,
      updatedAt: input.nowMs,
    };

    if (input.incrementCurrentVersion) {
      setPayload.currentVersion = sql`${operations.currentVersion} + 1`;
    }

    const [updated] = await executor
      .update(operations)
      .set(setPayload)
      .where(
        and(
          eq(operations.id, input.operationId),
          eq(operations.ownerId, input.ownerId),
          eq(operations.editVersion, input.expectedEditVersion)
        )
      )
      .returning();

    return updated ?? null;
  }

  async updateOperationSimple(
    operationId: string,
    ownerId: string,
    patch: Partial<
      Pick<OperationRecord, "isArchived" | "lastVerifiedAt" | "updatedAt">
    >,
    executor: DbExecutor = this.database
  ): Promise<OperationRecord | null> {
    const [updated] = await executor
      .update(operations)
      .set({
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
      })
      .where(
        and(eq(operations.id, operationId), eq(operations.ownerId, ownerId))
      )
      .returning();

    return updated ?? null;
  }

  async deleteOperationForOwner(
    operationId: string,
    ownerId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(operations)
      .where(
        and(eq(operations.id, operationId), eq(operations.ownerId, ownerId))
      )
      .returning({ id: operations.id });
    return deleted.length > 0;
  }

  async createVersion(
    input: CreateOperationVersionRowInput,
    executor: DbExecutor = this.database
  ): Promise<OperationVersionRecord> {
    const [created] = await executor
      .insert(operationVersions)
      .values({
        operationId: input.operationId,
        versionNumber: input.versionNumber,
        variablesSchemaJson: input.variablesSchemaJson,
        prerequisitesJson: input.prerequisitesJson,
        stepsSnapshotJson: input.stepsSnapshotJson,
        changeSummary: input.changeSummary ?? null,
        createdById: input.createdById,
        createdAt: input.nowMs,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert operation version.");
    }
    return created;
  }

  async getLatestVersion(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationVersionRecord | null> {
    const [row] = await executor
      .select()
      .from(operationVersions)
      .where(eq(operationVersions.operationId, operationId))
      .orderBy(desc(operationVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }

  async getVersionById(
    versionId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationVersionRecord | null> {
    const [row] = await executor
      .select()
      .from(operationVersions)
      .where(eq(operationVersions.id, versionId))
      .limit(1);
    return row ?? null;
  }

  async getVersionByNumber(
    operationId: string,
    versionNumber: number,
    executor: DbExecutor = this.database
  ): Promise<OperationVersionRecord | null> {
    const [row] = await executor
      .select()
      .from(operationVersions)
      .where(
        and(
          eq(operationVersions.operationId, operationId),
          eq(operationVersions.versionNumber, versionNumber)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listVersionsForOperation(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationVersionRecord[]> {
    return executor
      .select()
      .from(operationVersions)
      .where(eq(operationVersions.operationId, operationId))
      .orderBy(desc(operationVersions.versionNumber));
  }

  async listReferenceNotesForOperation(
    operationId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationReferenceNoteSummary[]> {
    return executor
      .select({
        id: notes.id,
        title: notes.title,
        projectId: notes.projectId,
        updatedAt: notes.updatedAt,
      })
      .from(operationReferenceNotes)
      .innerJoin(notes, eq(operationReferenceNotes.noteId, notes.id))
      .where(eq(operationReferenceNotes.operationId, operationId))
      .orderBy(asc(notes.title));
  }

  async replaceReferenceNotes(
    operationId: string,
    noteIds: string[],
    executor: DbExecutor = this.database
  ): Promise<OperationReferenceNoteRecord[]> {
    await executor
      .delete(operationReferenceNotes)
      .where(eq(operationReferenceNotes.operationId, operationId));

    const uniqueNoteIds = Array.from(new Set(noteIds));
    if (uniqueNoteIds.length === 0) return [];

    return executor
      .insert(operationReferenceNotes)
      .values(
        uniqueNoteIds.map((noteId) => ({
          operationId,
          noteId,
        }))
      )
      .returning();
  }

  async createRun(
    input: CreateOperationRunRowInput,
    executor: DbExecutor = this.database
  ): Promise<OperationRunRecord> {
    const [created] = await executor
      .insert(operationRuns)
      .values({
        operationId: input.operationId,
        versionId: input.versionId,
        runnerId: input.runnerId,
        title: input.title,
        status: "in_progress",
        variablesValuesJson: input.variablesValuesJson,
        prerequisitesCheckedJson: input.prerequisitesCheckedJson,
        startedAt: input.nowMs,
        completedAt: null,
        updatedAt: input.nowMs,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create operation run.");
    }
    return created;
  }

  async getRunByIdForRunner(
    runId: string,
    runnerId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationRunRecord | null> {
    const [row] = await executor
      .select()
      .from(operationRuns)
      .where(
        and(eq(operationRuns.id, runId), eq(operationRuns.runnerId, runnerId))
      )
      .limit(1);
    return row ?? null;
  }

  async listRunsForUser(
    runnerId: string,
    options: {
      status?: OperationRunStatus;
      operationId?: string;
      limit?: number;
    } = {},
    executor: DbExecutor = this.database
  ): Promise<OperationRunListRow[]> {
    const conditions = [eq(operationRuns.runnerId, runnerId)];
    if (options.status) {
      conditions.push(eq(operationRuns.status, options.status));
    }
    if (options.operationId) {
      conditions.push(eq(operationRuns.operationId, options.operationId));
    }

    const joined = await executor
      .select({
        run: operationRuns,
        operationTitle: operations.title,
        operationDomain: operations.domain,
        operationSlug: operations.slug,
        versionNumber: operationVersions.versionNumber,
        stepsSnapshotJson: operationVersions.stepsSnapshotJson,
      })
      .from(operationRuns)
      .innerJoin(operations, eq(operationRuns.operationId, operations.id))
      .innerJoin(
        operationVersions,
        eq(operationRuns.versionId, operationVersions.id)
      )
      .where(and(...conditions))
      .orderBy(desc(operationRuns.updatedAt), desc(operationRuns.id))
      .limit(options.limit ?? 50);

    if (joined.length === 0) return [];

    const runIds = joined.map((j) => j.run.id);
    const stepRows = await executor
      .select({
        runId: operationRunSteps.runId,
        status: operationRunSteps.status,
      })
      .from(operationRunSteps)
      .where(inArray(operationRunSteps.runId, runIds));

    const statsByRun = new Map<
      string,
      { done: number; skipped: number; blocked: number }
    >();
    for (const step of stepRows) {
      const current = statsByRun.get(step.runId) ?? {
        done: 0,
        skipped: 0,
        blocked: 0,
      };
      if (step.status === "done") current.done += 1;
      else if (step.status === "skipped") current.skipped += 1;
      else if (step.status === "blocked") current.blocked += 1;
      statsByRun.set(step.runId, current);
    }

    return joined.map((item) => {
      const stats = statsByRun.get(item.run.id) ?? {
        done: 0,
        skipped: 0,
        blocked: 0,
      };
      return {
        run: item.run,
        operationTitle: item.operationTitle,
        operationDomain: item.operationDomain,
        operationSlug: item.operationSlug,
        versionNumber: item.versionNumber,
        totalSteps: countStepsFromJson(item.stepsSnapshotJson),
        doneSteps: stats.done,
        skippedSteps: stats.skipped,
        blockedSteps: stats.blocked,
      };
    });
  }

  async updateRunPreflight(
    runId: string,
    runnerId: string,
    patch: {
      title?: string;
      variablesValuesJson?: string;
      prerequisitesCheckedJson?: string;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<OperationRunRecord | null> {
    const updates: Partial<typeof operationRuns.$inferInsert> = {
      updatedAt: patch.nowMs,
    };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.variablesValuesJson !== undefined) {
      updates.variablesValuesJson = patch.variablesValuesJson;
    }
    if (patch.prerequisitesCheckedJson !== undefined) {
      updates.prerequisitesCheckedJson = patch.prerequisitesCheckedJson;
    }

    const [updated] = await executor
      .update(operationRuns)
      .set(updates)
      .where(
        and(
          eq(operationRuns.id, runId),
          eq(operationRuns.runnerId, runnerId),
          eq(operationRuns.status, "in_progress")
        )
      )
      .returning();

    return updated ?? null;
  }

  async completeRunAtomically(
    runId: string,
    runnerId: string,
    completedAt: number,
    executor: DbExecutor = this.database
  ): Promise<OperationRunRecord | null> {
    const [updated] = await executor
      .update(operationRuns)
      .set({
        status: "completed",
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(operationRuns.id, runId),
          eq(operationRuns.runnerId, runnerId),
          eq(operationRuns.status, "in_progress")
        )
      )
      .returning();

    return updated ?? null;
  }

  async abandonRunAtomically(
    runId: string,
    runnerId: string,
    updatedAt: number,
    executor: DbExecutor = this.database
  ): Promise<OperationRunRecord | null> {
    const [updated] = await executor
      .update(operationRuns)
      .set({
        status: "abandoned",
        updatedAt,
      })
      .where(
        and(
          eq(operationRuns.id, runId),
          eq(operationRuns.runnerId, runnerId),
          eq(operationRuns.status, "in_progress")
        )
      )
      .returning();

    return updated ?? null;
  }

  async listRunSteps(
    runId: string,
    executor: DbExecutor = this.database
  ): Promise<OperationRunStepRecord[]> {
    return executor
      .select()
      .from(operationRunSteps)
      .where(eq(operationRunSteps.runId, runId))
      .orderBy(asc(operationRunSteps.stepKey));
  }

  async seedRunStepsBatch(
    runId: string,
    stepKeys: string[],
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<OperationRunStepRecord[]> {
    if (stepKeys.length === 0) return [];
    return executor
      .insert(operationRunSteps)
      .values(
        stepKeys.map((stepKey) => ({
          runId,
          stepKey,
          status: "pending" as const,
          note: null,
          completedAt: null,
          updatedAt: nowMs,
        }))
      )
      .returning();
  }

  async upsertRunStep(
    params: {
      runId: string;
      stepKey: string;
      status: OperationRunStepStatus;
      note?: string | null;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<OperationRunStepRecord> {
    const completedAt = params.status === "done" ? params.nowMs : null;
    const setPatch: Partial<typeof operationRunSteps.$inferInsert> = {
      status: params.status,
      completedAt,
      updatedAt: params.nowMs,
    };
    if (params.note !== undefined) {
      setPatch.note = params.note;
    }

    const [row] = await executor
      .insert(operationRunSteps)
      .values({
        runId: params.runId,
        stepKey: params.stepKey,
        status: params.status,
        note: params.note ?? null,
        completedAt,
        updatedAt: params.nowMs,
      })
      .onConflictDoUpdate({
        target: [operationRunSteps.runId, operationRunSteps.stepKey],
        set: setPatch,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert operation run step.");
    }
    return row;
  }
}

export const operationRepository: OperationRepository =
  new DrizzleOperationRepository(db);
