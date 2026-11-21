import { endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
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

export interface CreateTaskRowInput {
  userId: string;
  projectId?: string | null;
  assigneeId?: string | null;
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
}

export interface TaskRepository {
  create(
    input: CreateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord>;
  getById(taskId: string, executor?: DbExecutor): Promise<TaskRecord | null>;
  getByIdForUser(
    taskId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  getLastPositionForUser(
    userId: string,
    projectId: string | null,
    executor?: DbExecutor
  ): Promise<string | null>;
  updateById(
    taskId: string,
    patch: UpdateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  updateForUser(
    taskId: string,
    userId: string,
    patch: UpdateTaskRowInput,
    executor?: DbExecutor
  ): Promise<TaskRecord | null>;
  deleteById(taskId: string, executor?: DbExecutor): Promise<boolean>;
  deleteForUser(
    taskId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
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

  async getById(
    taskId: string,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord | null> {
    const [row] = await executor
      .select()
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
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    return row ?? null;
  }

  async getLastPositionForUser(
    userId: string,
    projectId: string | null,
    executor: DbExecutor = this.database
  ): Promise<string | null> {
    const [row] = await executor
      .select({ position: tasks.position })
      .from(tasks)
      .where(
        projectId
          ? eq(tasks.projectId, projectId)
          : and(eq(tasks.userId, userId), isNull(tasks.projectId))
      )
      .orderBy(desc(tasks.position))
      .limit(1);

    return row?.position ?? null;
  }

  async updateById(
    taskId: string,
    patch: UpdateTaskRowInput,
    executor: DbExecutor = this.database
  ): Promise<TaskRecord | null> {
    const [updated] = await executor
      .update(tasks)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    return updated ?? null;
  }

  async updateForUser(
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
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    return updated ?? null;
  }

  async deleteById(
    taskId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(tasks)
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id });

    return deleted.length > 0;
  }

  async deleteForUser(
    taskId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning({ id: tasks.id });

    return deleted.length > 0;
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
            eq(reminders.entityType, "task"),
            inArray(reminders.entityId, taskIds),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
          )
        )
        .orderBy(asc(reminders.remindAt)),
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
      const list = remindersByTask.get(rem.entityId) ?? [];
      list.push(rem);
      remindersByTask.set(rem.entityId, list);
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
      .orderBy(asc(tasks.position), desc(tasks.createdAt))
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
      .select({ entityId: reminders.entityId })
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.entityType, "task"),
          inArray(reminders.status, ["scheduled", "snoozed"]),
          lte(reminders.remindAt, endOfTodayMs)
        )
      );

    const reminderTaskIds = Array.from(
      new Set(dueReminderTaskRows.map((r) => r.entityId))
    );

    const condition =
      reminderTaskIds.length > 0
        ? or(
            lte(tasks.dueAt, endOfTodayMs),
            inArray(tasks.id, reminderTaskIds)
          )
        : lte(tasks.dueAt, endOfTodayMs);

    const rows = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.status, ["todo", "in_progress"]),
          condition
        )
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.position))
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
      .select({ entityId: reminders.entityId })
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.entityType, "task"),
          inArray(reminders.status, ["pending_far", "scheduled", "snoozed"]),
          gt(reminders.remindAt, endOfTodayMs)
        )
      );

    const futureReminderTaskIds = Array.from(
      new Set(futureReminderTaskRows.map((r) => r.entityId))
    );

    const condition =
      futureReminderTaskIds.length > 0
        ? or(
            gt(tasks.dueAt, endOfTodayMs),
            inArray(tasks.id, futureReminderTaskIds)
          )
        : gt(tasks.dueAt, endOfTodayMs);

    const rows = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.status, ["todo", "in_progress"]),
          condition
        )
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.position))
      .limit(150);

    const items = await this.hydrateTasks(userId, rows);
    return { items, referenceUtcMs };
  }
}

export const taskRepository: TaskRepository = new DrizzleTaskRepository(db);
