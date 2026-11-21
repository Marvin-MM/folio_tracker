import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projectMembers,
  reminders,
  tasks,
  type ReminderEntityType,
  type ReminderRecord,
  type ReminderStatus,
} from "@/server/db/schema";

export interface CreateReminderRowInput {
  userId: string;
  entityType: ReminderEntityType;
  entityId: string;
  remindAt: number;
  timezone: string;
  status: ReminderStatus;
}

export interface UpdateReminderOptimisticInput {
  reminderId: string;
  userId: string;
  expectedVersion: number;
  remindAt?: number;
  timezone?: string;
  status: ReminderStatus;
  sentAt?: number | null;
}

export interface EnrichedReminderItem {
  reminder: ReminderRecord;
  entityTitle: string;
  entityStatus: string | null;
  deepLink: string;
}

export interface ReminderRepository {
  create(
    input: CreateReminderRowInput,
    executor?: DbExecutor
  ): Promise<ReminderRecord>;
  getById(
    reminderId: string,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  getByIdForUser(
    reminderId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  listActiveForEntity(
    userId: string,
    entityType: ReminderEntityType,
    entityId: string
  ): Promise<ReminderRecord[]>;
  listActiveForUserWithEntities(userId: string): Promise<EnrichedReminderItem[]>;
  updateWithVersion(
    input: UpdateReminderOptimisticInput,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  claimForDelivery(
    params: { reminderId: string; expectedVersion: number; sentAt: number },
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  cancelActiveForEntity(
    params: {
      userId: string;
      entityType: ReminderEntityType;
      entityId: string;
    },
    executor?: DbExecutor
  ): Promise<Array<{ id: string; version: number }>>;
  findPendingFarWithinHorizon(
    cutoffUtcMs: number,
    limit?: number
  ): Promise<ReminderRecord[]>;
  promotePendingFarToScheduled(
    reminderId: string,
    expectedVersion: number,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  getEntitySummary(
    entityType: ReminderEntityType,
    entityId: string,
    userId: string
  ): Promise<{ title: string; snippet: string; deepLink: string } | null>;
}

const ACTIVE_REMINDER_STATUSES: ReminderStatus[] = [
  "pending_far",
  "scheduled",
  "snoozed",
];

export class DrizzleReminderRepository implements ReminderRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async create(
    input: CreateReminderRowInput,
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(reminders)
      .values({
        userId: input.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        remindAt: input.remindAt,
        timezone: input.timezone,
        status: input.status,
        version: 1,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert reminder.");
    }
    return created;
  }

  async getById(
    reminderId: string,
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const [row] = await executor
      .select()
      .from(reminders)
      .where(eq(reminders.id, reminderId))
      .limit(1);

    return row ?? null;
  }

  async getByIdForUser(
    reminderId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const [row] = await executor
      .select()
      .from(reminders)
      .where(
        and(eq(reminders.id, reminderId), eq(reminders.userId, userId))
      )
      .limit(1);

    return row ?? null;
  }

  async listActiveForEntity(
    userId: string,
    entityType: ReminderEntityType,
    entityId: string
  ): Promise<ReminderRecord[]> {
    return this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.entityType, entityType),
          eq(reminders.entityId, entityId),
          inArray(reminders.status, ACTIVE_REMINDER_STATUSES)
        )
      )
      .orderBy(asc(reminders.remindAt));
  }

  async listActiveForUserWithEntities(
    userId: string
  ): Promise<EnrichedReminderItem[]> {
    const rows = await this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          inArray(reminders.status, [...ACTIVE_REMINDER_STATUSES, "sent"])
        )
      )
      .orderBy(asc(reminders.remindAt))
      .limit(150);

    if (rows.length === 0) {
      return [];
    }

    const taskIds = rows
      .filter((r) => r.entityType === "task")
      .map((r) => r.entityId);
    const noteIds = rows
      .filter((r) => r.entityType === "note")
      .map((r) => r.entityId);

    const [taskRows, noteRows] = await Promise.all([
      taskIds.length > 0
        ? this.database
            .select({
              id: tasks.id,
              title: tasks.title,
              status: tasks.status,
              projectId: tasks.projectId,
            })
            .from(tasks)
            .where(inArray(tasks.id, taskIds))
        : Promise.resolve([]),
      noteIds.length > 0
        ? this.database
            .select({
              id: notes.id,
              title: notes.title,
              projectId: notes.projectId,
            })
            .from(notes)
            .where(inArray(notes.id, noteIds))
        : Promise.resolve([]),
    ]);

    const taskMap = new Map(taskRows.map((t) => [t.id, t]));
    const noteMap = new Map(noteRows.map((n) => [n.id, n]));

    return rows.map((reminder) => {
      if (reminder.entityType === "task") {
        const task = taskMap.get(reminder.entityId);
        return {
          reminder,
          entityTitle: task?.title ?? "Deleted task",
          entityStatus: task?.status ?? null,
          deepLink: task?.projectId
            ? `/app/projects/${encodeURIComponent(task.projectId)}?item=${encodeURIComponent(reminder.entityId)}`
            : `/app/inbox?item=${encodeURIComponent(reminder.entityId)}`,
        };
      }
      const note = noteMap.get(reminder.entityId);
      return {
        reminder,
        entityTitle: note?.title ?? "Deleted note",
        entityStatus: null,
        deepLink: note?.projectId
          ? `/app/projects/${encodeURIComponent(note.projectId)}?tab=notes&item=${encodeURIComponent(reminder.entityId)}`
          : `/app/notes?item=${encodeURIComponent(reminder.entityId)}`,
      };
    });
  }

  async updateWithVersion(
    input: UpdateReminderOptimisticInput,
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const now = Date.now();
    const [updated] = await executor
      .update(reminders)
      .set({
        ...(input.remindAt !== undefined ? { remindAt: input.remindAt } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        status: input.status,
        ...(input.sentAt !== undefined ? { sentAt: input.sentAt } : {}),
        version: sql`${reminders.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(reminders.id, input.reminderId),
          eq(reminders.userId, input.userId),
          eq(reminders.version, input.expectedVersion)
        )
      )
      .returning();

    return updated ?? null;
  }

  async claimForDelivery(
    params: { reminderId: string; expectedVersion: number; sentAt: number },
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const [claimed] = await executor
      .update(reminders)
      .set({
        status: "sent",
        sentAt: params.sentAt,
        updatedAt: params.sentAt,
      })
      .where(
        and(
          eq(reminders.id, params.reminderId),
          eq(reminders.status, "scheduled"),
          eq(reminders.version, params.expectedVersion)
        )
      )
      .returning();

    return claimed ?? null;
  }

  async cancelActiveForEntity(
    params: {
      userId: string;
      entityType: ReminderEntityType;
      entityId: string;
    },
    executor: DbExecutor = this.database
  ): Promise<Array<{ id: string; version: number }>> {
    const now = Date.now();
    return executor
      .update(reminders)
      .set({
        status: "cancelled",
        version: sql`${reminders.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(reminders.userId, params.userId),
          eq(reminders.entityType, params.entityType),
          eq(reminders.entityId, params.entityId),
          inArray(reminders.status, ACTIVE_REMINDER_STATUSES)
        )
      )
      .returning({
        id: reminders.id,
        version: reminders.version,
      });
  }

  async findPendingFarWithinHorizon(
    cutoffUtcMs: number,
    limit = 100
  ): Promise<ReminderRecord[]> {
    return this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "pending_far"),
          lte(reminders.remindAt, cutoffUtcMs)
        )
      )
      .orderBy(asc(reminders.remindAt))
      .limit(limit);
  }

  async promotePendingFarToScheduled(
    reminderId: string,
    expectedVersion: number,
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const [promoted] = await executor
      .update(reminders)
      .set({
        status: "scheduled",
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(reminders.id, reminderId),
          eq(reminders.status, "pending_far"),
          eq(reminders.version, expectedVersion)
        )
      )
      .returning();

    return promoted ?? null;
  }

  async getEntitySummary(
    entityType: ReminderEntityType,
    entityId: string,
    userId: string
  ): Promise<{ title: string; snippet: string; deepLink: string } | null> {
    if (entityType === "task") {
      const [task] = await this.database
        .select({
          title: tasks.title,
          description: tasks.description,
          projectId: tasks.projectId,
          userId: tasks.userId,
        })
        .from(tasks)
        .where(eq(tasks.id, entityId))
        .limit(1);

      if (!task) return null;
      if (task.projectId) {
        const [member] = await this.database
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, task.projectId),
              eq(projectMembers.userId, userId)
            )
          )
          .limit(1);
        if (!member) return null;
      } else if (task.userId !== userId) {
        return null;
      }

      const snippet = (task.description ?? "").trim().slice(0, 140);
      return {
        title: task.title,
        snippet: snippet || "Scheduled task reminder.",
        deepLink: task.projectId
          ? `/app/projects/${encodeURIComponent(task.projectId)}?item=${encodeURIComponent(entityId)}`
          : `/app/inbox?item=${encodeURIComponent(entityId)}`,
      };
    }

    const [note] = await this.database
      .select({
        title: notes.title,
        content: notes.content,
        projectId: notes.projectId,
        userId: notes.userId,
      })
      .from(notes)
      .where(eq(notes.id, entityId))
      .limit(1);

    if (!note) return null;
    if (note.projectId) {
      const [member] = await this.database
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, note.projectId),
            eq(projectMembers.userId, userId)
          )
        )
        .limit(1);
      if (!member) return null;
    } else if (note.userId !== userId) {
      return null;
    }

    const snippet = note.content
      .replace(/[#*_`>\-\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

    return {
      title: note.title,
      snippet: snippet || "Scheduled note reminder.",
      deepLink: note.projectId
        ? `/app/projects/${encodeURIComponent(note.projectId)}?tab=notes&item=${encodeURIComponent(entityId)}`
        : `/app/notes?item=${encodeURIComponent(entityId)}`,
    };
  }
}

export const reminderRepository: ReminderRepository =
  new DrizzleReminderRepository(db);
