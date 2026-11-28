import { endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { generateEvenPositions } from "@/lib/fractional-index";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  projectMembers,
  projects,
  reminders,
  tasks,
  type ReminderRecord,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from "@/server/db/schema";

export interface TaskWithReminders {
  task: TaskRecord;
  projectName: string | null;
  projectColorToken: string | null;
  reminders: ReminderRecord[];
}

export interface TaskListQueryResult {
  items: TaskWithReminders[];
  referenceUtcMs: number;
}

export interface TaskAuthMetadata {
  id: string;
  userId: string;
  projectId: string | null;
  assigneeId: string | null;
  habitId: string | null;
  habitDateKey: string | null;
  operationId: string | null;
  operationRunId: string | null;
  title: string;
  status: TaskStatus;
  dueAt: number | null;
  completedAt: number | null;
  position: string;
}

export interface CreateTaskRowInput {
  userId: string;
  projectId?: string | null;
  assigneeId?: string | null;
  habitId?: string | null;
  habitDateKey?: string | null;
  operationId?: string | null;
  operationRunId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: number | null;
  position: string;
}

export interface UpdateTaskRowInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: number | null;
  position?: string;
  completedAt?: number | null;
  projectId?: string | null;
  assigneeId?: string | null;
  habitId?: string | null;
  habitDateKey?: string | null;
  operationId?: string | null;
  operationRunId?: string | null;
}

export type TaskScope =
  | { kind: "personal"; userId: string }
  | { kind: "project"; projectId: string };

export interface TaskRepository {
  create(
    input: CreateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord>;
  getAuthMetadata(
    taskId: string,
    executor?: DbExecutor
  ): Promise<TaskAuthMetadata | null>;
  getByIdForUser(
    taskId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  getLastPositionForScope(
    scope: TaskScope,
    executor?: DbExecutor
  ): Promise<string | null>;
  updatePersonalTask(
    taskId: string,
    userId: string,
    patch: UpdateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  updateProjectTask(
    taskId: string,
    projectId: string,
    patch: UpdateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  deletePersonalTask(
    taskId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  deleteProjectTask(
    taskId: string,
    projectId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  rebalancePositions(
    scope: TaskScope,
    executor?: DbExecutor
  ): Promise<number>;
  syncLinkedTasksForHabitDay(
    params: {
      userId: string;
      habitId: string;
      dateKey: string;
      completed: boolean;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<number>;
  /** Batch counterpart used by history imports. */
  syncLinkedTasksForHabitLogs(
    params: {
      userId: string;
      entries: Array<{
        habitId: string;
        dateKey: string;
        completed: boolean;
      }>;
      nowMs: number;
    },
    executor?: DbExecutor
  ): Promise<number>;
  listInboxWithReminders(userId: string): Promise<TaskListQueryResult>;
  listTodayWithReminders(
    userId: string,
    timezone: string
  ): Promise<TaskListQueryResult>;
  listUpcomingWithReminders(
    userId: string,
    timezone: string
  ): Promise<TaskListQueryResult>;
}

function getEndOfTodayUtcMs(timezone: string, now: Date): number {
  try {
    const zonedNow = toZonedTime(now, timezone);
    return fromZonedTime(endOfDay(zonedNow), timezone).getTime();
  } catch {
    const zonedNow = toZonedTime(now, "UTC");
    return fromZonedTime(endOfDay(zonedNow), "UTC").getTime();
  }
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async create(
    input: CreateTaskRowInput,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(tasks)
      .values({
        userId: input.userId,
        projectId: input.projectId ?? null,
        assigneeId: input.assigneeId ?? null,
        habitId: input.habitId ?? null,
        habitDateKey: input.habitDateKey ?? null,
        operationId: input.operationId ?? null,
        operationRunId: input.operationRunId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "todo",
        priority: input.priority ?? "none",
        dueAt: input.dueAt ?? null,
        position: input.position,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert task.");
    }
    return created;
  }

  /**
   * Minimal ownership/project metadata lookup used strictly by service-layer
   * authorization before dispatching tenant-scoped mutations.
   */
  async getAuthMetadata(
    taskId: string,
    executor: DbExecutor = this.database
  ): Promise<TaskAuthMetadata | null> {
    const [row] = await executor
      .select({
        id: tasks.id,
        userId: tasks.userId,
        projectId: tasks.projectId,
        assigneeId: tasks.assigneeId,
        habitId: tasks.habitId,
        habitDateKey: tasks.habitDateKey,
        operationId: tasks.operationId,
        operationRunId: tasks.operationRunId,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
        position: tasks.position,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    return row ?? null;
  }

  async getByIdForUser(
    taskId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord | null> {
    const [row] = await executor
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.projectId))
      )
      .limit(1);

    return row ?? null;
  }

  async getLastPositionForScope(
    scope: TaskScope,
    executor: DbExecutor = this.database
  ): Promise<string | null> {
    const predicate =
      scope.kind === "project"
        ? eq(tasks.projectId, scope.projectId)
        : and(eq(tasks.userId, scope.userId), isNull(tasks.projectId));

    const [row] = await executor
      .select({ position: tasks.position })
      .from(tasks)
      .where(predicate)
      .orderBy(desc(tasks.position), desc(tasks.id))
      .limit(1);

    return row?.position ?? null;
  }

  async updatePersonalTask(
    taskId: string,
    userId: string,
    patch: UpdateTaskRowInput,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord | null> {
    const [updated] = await executor
      .update(tasks)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.projectId))
      )
      .returning();

    return updated ?? null;
  }

  async updateProjectTask(
    taskId: string,
    projectId: string,
    patch: UpdateTaskRowInput,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord | null> {
    const [updated] = await executor
      .update(tasks)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
      .returning();

    return updated ?? null;
  }

  async deletePersonalTask(
    taskId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.projectId))
      )
      .returning({ id: tasks.id });

    return deleted.length > 0;
  }

  async deleteProjectTask(
    taskId: string,
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
      .returning({ id: tasks.id });

    return deleted.length > 0;
  }

  /**
   * Transactionally re-spaces all task positions within a personal Inbox or
   * verified project scope in deterministic `(position ASC, id ASC)` order
   * whenever a generated fractional key exceeds 32 characters.
   */
  async rebalancePositions(
    scope: TaskScope,
    executor: DbExecutor = this.database
  ): Promise<number> {
    const predicate =
      scope.kind === "project"
        ? eq(tasks.projectId, scope.projectId)
        : and(eq(tasks.userId, scope.userId), isNull(tasks.projectId));

    const ordered = await executor
      .select({ id: tasks.id })
      .from(tasks)
      .where(predicate)
      .orderBy(asc(tasks.position), asc(tasks.id));

    if (ordered.length === 0) return 0;

    const freshKeys = generateEvenPositions(ordered.length);
    const now = Date.now();
    const chunkSize = 200;

    for (let start = 0; start < ordered.length; start += chunkSize) {
      const slice = ordered.slice(start, start + chunkSize);
      const ids = slice.map((r) => r.id);
      const caseParts = slice.map((row, idx) =>
        sql`WHEN ${tasks.id} = ${row.id} THEN ${freshKeys[start + idx]!}`
      );
      const caseExpr = sql`CASE ${sql.join(caseParts, sql` `)} ELSE ${tasks.position} END`;
      const chunkPredicate =
        scope.kind === "project"
          ? and(inArray(tasks.id, ids), eq(tasks.projectId, scope.projectId))
          : and(
              inArray(tasks.id, ids),
              eq(tasks.userId, scope.userId),
              isNull(tasks.projectId)
            );
      await executor
        .update(tasks)
        .set({ position: caseExpr, updatedAt: now })
        .where(chunkPredicate);
    }

    return ordered.length;
  }

  async syncLinkedTasksForHabitDay(
    params: {
      userId: string;
      habitId: string;
      dateKey: string;
      completed: boolean;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<number> {
    const updated = await executor
      .update(tasks)
      .set({
        status: params.completed ? "done" : "todo",
        completedAt: params.completed ? params.nowMs : null,
        updatedAt: params.nowMs,
      })
      .where(
        and(
          eq(tasks.userId, params.userId),
          eq(tasks.habitId, params.habitId),
          eq(tasks.habitDateKey, params.dateKey),
          ne(tasks.status, "archived")
        )
      )
      .returning({ id: tasks.id });

    return updated.length;
  }

  async syncLinkedTasksForHabitLogs(
    params: {
      userId: string;
      entries: Array<{
        habitId: string;
        dateKey: string;
        completed: boolean;
      }>;
      nowMs: number;
    },
    executor: DbExecutor = this.database
  ): Promise<number> {
    if (params.entries.length === 0) return 0;

    let minDate = params.entries[0]!.dateKey;
    let maxDate = params.entries[0]!.dateKey;
    const desiredByKey = new Map<string, boolean>();
    for (const entry of params.entries) {
      if (entry.dateKey < minDate) minDate = entry.dateKey;
      if (entry.dateKey > maxDate) maxDate = entry.dateKey;
      desiredByKey.set(`${entry.habitId}|${entry.dateKey}`, entry.completed);
    }

    // 1 indexed range read short-circuits 99.9% of historical backfills (0 linked tasks)
    // instead of firing hundreds of OR-clause UPDATE scans over remote Turso.
    const linkedTasks = await executor
      .select({
        id: tasks.id,
        habitId: tasks.habitId,
        habitDateKey: tasks.habitDateKey,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, params.userId),
          isNotNull(tasks.habitId),
          isNotNull(tasks.habitDateKey),
          gte(tasks.habitDateKey, minDate),
          lte(tasks.habitDateKey, maxDate),
          ne(tasks.status, "archived")
        )
      );

    if (linkedTasks.length === 0) return 0;

    const toCompleteIds: string[] = [];
    const toReopenIds: string[] = [];

    for (const task of linkedTasks) {
      if (!task.habitId || !task.habitDateKey) continue;
      const desired = desiredByKey.get(`${task.habitId}|${task.habitDateKey}`);
      if (desired === undefined) continue;
      if (desired) {
        toCompleteIds.push(task.id);
      } else {
        toReopenIds.push(task.id);
      }
    }

    let updatedCount = 0;
    const idChunkSize = 500;

    for (let i = 0; i < toCompleteIds.length; i += idChunkSize) {
      const ids = toCompleteIds.slice(i, i + idChunkSize);
      const updated = await executor
        .update(tasks)
        .set({
          status: "done",
          completedAt: params.nowMs,
          updatedAt: params.nowMs,
        })
        .where(and(eq(tasks.userId, params.userId), inArray(tasks.id, ids)))
        .returning({ id: tasks.id });
      updatedCount += updated.length;
    }

    for (let i = 0; i < toReopenIds.length; i += idChunkSize) {
      const ids = toReopenIds.slice(i, i + idChunkSize);
      const updated = await executor
        .update(tasks)
        .set({
          status: "todo",
          completedAt: null,
          updatedAt: params.nowMs,
        })
        .where(and(eq(tasks.userId, params.userId), inArray(tasks.id, ids)))
        .returning({ id: tasks.id });
      updatedCount += updated.length;
    }

    return updatedCount;
  }

  private async hydrateTasks(
    userId: string,
    rows: TaskRecord[]
  ): Promise<TaskWithReminders[]> {
    if (rows.length === 0) {
      return [];
    }

    const taskIds = rows.map((r) => r.id);
    const projectIds = Array.from(
      new Set(
        rows
          .map((r) => r.projectId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const [reminderRows, projectRows] = await Promise.all([
      this.database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            inArray(reminders.taskId, taskIds),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
          )
        )
        .orderBy(asc(reminders.remindAt), asc(reminders.id)),
      projectIds.length > 0
        ? this.database
            .select({
              id: projects.id,
              name: projects.name,
              colorToken: projects.colorToken,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds))
        : Promise.resolve([]),
    ]);

    const remindersByTask = new Map<string, ReminderRecord[]>();
    for (const rem of reminderRows) {
      if (!rem.taskId) continue;
      const list = remindersByTask.get(rem.taskId) ?? [];
      list.push(rem);
      remindersByTask.set(rem.taskId, list);
    }

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));

    return rows.map((task) => {
      const project = task.projectId ? projectMap.get(task.projectId) : null;
      return {
        task,
        projectName: project?.name ?? null,
        projectColorToken: project?.colorToken ?? null,
        reminders: remindersByTask.get(task.id) ?? [],
      };
    });
  }

  async listInboxWithReminders(userId: string): Promise<TaskListQueryResult> {
    const referenceUtcMs = Date.now();
    const rows = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.projectId),
          ne(tasks.status, "archived")
        )
      )
      .orderBy(asc(tasks.position), asc(tasks.id))
      .limit(150);

    const items = await this.hydrateTasks(userId, rows);
    return { items, referenceUtcMs };
  }

  async listTodayWithReminders(
    userId: string,
    timezone: string
  ): Promise<TaskListQueryResult> {
    const referenceUtcMs = Date.now();
    const endOfTodayMs = getEndOfTodayUtcMs(
      timezone,
      new Date(referenceUtcMs)
    );

    const dueReminderTaskRows = await this.database
      .select({ taskId: reminders.taskId })
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          isNotNull(reminders.taskId),
          inArray(reminders.status, ["scheduled", "snoozed"]),
          lte(reminders.remindAt, endOfTodayMs)
        )
      );

    const reminderTaskIds = Array.from(
      new Set(
        dueReminderTaskRows
          .map((r) => r.taskId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const condition =
      reminderTaskIds.length > 0
        ? or(
            lte(tasks.dueAt, endOfTodayMs),
            inArray(tasks.id, reminderTaskIds)
          )
        : lte(tasks.dueAt, endOfTodayMs);

    const activeProjectMembershipPredicate = or(
      isNull(tasks.projectId),
      exists(
        this.database
          .select({ one: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, tasks.projectId),
              eq(projectMembers.userId, userId)
            )
          )
      )
    );

    const rows = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          activeProjectMembershipPredicate,
          inArray(tasks.status, ["todo", "in_progress"]),
          condition
        )
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.position), asc(tasks.id))
      .limit(150);

    const items = await this.hydrateTasks(userId, rows);
    return { items, referenceUtcMs };
  }

  async listUpcomingWithReminders(
    userId: string,
    timezone: string
  ): Promise<TaskListQueryResult> {
    const referenceUtcMs = Date.now();
    const endOfTodayMs = getEndOfTodayUtcMs(
      timezone,
      new Date(referenceUtcMs)
    );

    const futureReminderTaskRows = await this.database
      .select({ taskId: reminders.taskId })
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          isNotNull(reminders.taskId),
          inArray(reminders.status, ["pending_far", "scheduled", "snoozed"]),
          gt(reminders.remindAt, endOfTodayMs)
        )
      );

    const futureReminderTaskIds = Array.from(
      new Set(
        futureReminderTaskRows
          .map((r) => r.taskId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const condition =
      futureReminderTaskIds.length > 0
        ? or(
            gt(tasks.dueAt, endOfTodayMs),
            inArray(tasks.id, futureReminderTaskIds)
          )
        : gt(tasks.dueAt, endOfTodayMs);

    const activeProjectMembershipPredicate = or(
      isNull(tasks.projectId),
      exists(
        this.database
          .select({ one: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, tasks.projectId),
              eq(projectMembers.userId, userId)
            )
          )
      )
    );

    const rows = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          activeProjectMembershipPredicate,
          inArray(tasks.status, ["todo", "in_progress"]),
          condition
        )
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.position), asc(tasks.id))
      .limit(150);

    const items = await this.hydrateTasks(userId, rows);
    return { items, referenceUtcMs };
  }
}

export const taskRepository: TaskRepository = new DrizzleTaskRepository(db);
