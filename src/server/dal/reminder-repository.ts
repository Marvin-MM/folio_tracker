import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projectMembers,
  projects,
  reminders,
  tasks,
  type ReminderRecord,
  type ReminderStatus,
  type ReminderTarget,
} from "@/server/db/schema";
import { canUserReadEntity } from "./auth-guard";

export interface CreateReminderRowInput {
  userId: string;
  taskId: string | null;
  noteId: string | null;
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
  dispatchedAt?: number | null;
  sentAt?: number | null;
}

export interface ScheduledReminderCancellationTarget {
  id: string;
  userId: string;
  version: number;
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
  getByIdForUser(
    reminderId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  listActiveForTarget(
    userId: string,
    target: ReminderTarget
  ): Promise<ReminderRecord[]>;
  listActiveForUserWithEntities(userId: string): Promise<EnrichedReminderItem[]>;
  updateWithVersion(
    input: UpdateReminderOptimisticInput,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  markDispatched(
    params: {
      reminderId: string;
      expectedVersion: number;
      dispatchedAt: number;
    },
    executor?: DbExecutor
  ): Promise<boolean>;
  claimForDelivery(
    params: {
      reminderId: string;
      userId: string;
      expectedVersion: number;
      sentAt: number;
    },
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  cancelIfRevoked(
    params: {
      reminderId: string;
      userId: string;
      expectedVersion: number;
      nowMs?: number;
    },
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  cancelActiveForTarget(
    params: {
      userId: string;
      taskId?: string | null;
      noteId?: string | null;
    },
    executor?: DbExecutor
  ): Promise<Array<{ id: string; userId: string; version: number }>>;
  findActiveScheduledForTask(
    taskId: string,
    executor?: DbExecutor
  ): Promise<ScheduledReminderCancellationTarget[]>;
  findActiveScheduledForNote(
    noteId: string,
    executor?: DbExecutor
  ): Promise<ScheduledReminderCancellationTarget[]>;
  findActiveScheduledForProject(
    projectId: string,
    executor?: DbExecutor
  ): Promise<ScheduledReminderCancellationTarget[]>;
  findActiveScheduledForUserAccountDeletion(
    userId: string,
    executor?: DbExecutor
  ): Promise<ScheduledReminderCancellationTarget[]>;
  findPendingFarWithinHorizon(
    cutoffUtcMs: number,
    limit?: number
  ): Promise<ReminderRecord[]>;
  promotePendingFarToScheduled(
    reminderId: string,
    expectedVersion: number,
    executor?: DbExecutor
  ): Promise<ReminderRecord | null>;
  findUndispatchedScheduled(
    staleBeforeUtcMs: number,
    limit?: number
  ): Promise<ReminderRecord[]>;
  getEntitySummary(
    target: ReminderTarget,
    userId: string,
    executor?: DbExecutor
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
        taskId: input.taskId,
        noteId: input.noteId,
        remindAt: input.remindAt,
        timezone: input.timezone,
        status: input.status,
        version: 1,
        dispatchedAt: null,
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

  async listActiveForTarget(
    userId: string,
    target: ReminderTarget
  ): Promise<ReminderRecord[]> {
    const targetPredicate = target.taskId
      ? eq(reminders.taskId, target.taskId)
      : eq(reminders.noteId, target.noteId!);

    return this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          targetPredicate,
          inArray(reminders.status, ACTIVE_REMINDER_STATUSES)
        )
      )
      .orderBy(asc(reminders.remindAt), asc(reminders.id));
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
      .orderBy(asc(reminders.remindAt), asc(reminders.id))
      .limit(150);

    if (rows.length === 0) {
      return [];
    }

    const taskIds = rows
      .map((r) => r.taskId)
      .filter((id): id is string => typeof id === "string");
    const noteIds = rows
      .map((r) => r.noteId)
      .filter((id): id is string => typeof id === "string");

    const [taskRows, noteRows, memberRows] = await Promise.all([
      taskIds.length > 0
        ? this.database
            .select({
              id: tasks.id,
              userId: tasks.userId,
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
              userId: notes.userId,
              title: notes.title,
              projectId: notes.projectId,
            })
            .from(notes)
            .where(inArray(notes.id, noteIds))
        : Promise.resolve([]),
      this.database
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, userId)),
    ]);

    const memberProjectIds = new Set(memberRows.map((m) => m.projectId));

    const taskMap = new Map(
      taskRows
        .filter((t) =>
          t.projectId ? memberProjectIds.has(t.projectId) : t.userId === userId
        )
        .map((t) => [t.id, t])
    );

    const noteMap = new Map(
      noteRows
        .filter((n) =>
          n.projectId ? memberProjectIds.has(n.projectId) : n.userId === userId
        )
        .map((n) => [n.id, n])
    );

    const enriched: EnrichedReminderItem[] = [];
    for (const reminder of rows) {
      if (reminder.taskId) {
        const task = taskMap.get(reminder.taskId);
        if (!task) continue;
        enriched.push({
          reminder,
          entityTitle: task.title,
          entityStatus: task.status,
          deepLink: task.projectId
            ? `/app/projects/${encodeURIComponent(task.projectId)}?item=${encodeURIComponent(task.id)}`
            : `/app/inbox?item=${encodeURIComponent(task.id)}`,
        });
      } else if (reminder.noteId) {
        const note = noteMap.get(reminder.noteId);
        if (!note) continue;
        enriched.push({
          reminder,
          entityTitle: note.title,
          entityStatus: null,
          deepLink: note.projectId
            ? `/app/projects/${encodeURIComponent(note.projectId)}?tab=notes&item=${encodeURIComponent(note.id)}`
            : `/app/notes?item=${encodeURIComponent(note.id)}`,
        });
      }
    }

    return enriched;
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
        ...(input.dispatchedAt !== undefined
          ? { dispatchedAt: input.dispatchedAt }
          : {}),
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

  async markDispatched(
    params: {
      reminderId: string;
      expectedVersion: number;
      dispatchedAt: number;
    },
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const updated = await executor
      .update(reminders)
      .set({
        dispatchedAt: params.dispatchedAt,
      })
      .where(
        and(
          eq(reminders.id, params.reminderId),
          eq(reminders.status, "scheduled"),
          eq(reminders.version, params.expectedVersion),
          isNull(reminders.dispatchedAt)
        )
      )
      .returning({ id: reminders.id });

    return updated.length > 0;
  }

  async claimForDelivery(
    params: {
      reminderId: string;
      userId: string;
      expectedVersion: number;
      sentAt: number;
    },
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
          eq(reminders.userId, params.userId),
          eq(reminders.status, "scheduled"),
          eq(reminders.version, params.expectedVersion)
        )
      )
      .returning();

    return claimed ?? null;
  }

  async cancelIfRevoked(
    params: {
      reminderId: string;
      userId: string;
      expectedVersion: number;
      nowMs?: number;
    },
    executor: DbExecutor = this.database
  ): Promise<ReminderRecord | null> {
    const now = params.nowMs ?? Date.now();
    const [cancelled] = await executor
      .update(reminders)
      .set({
        status: "cancelled",
        version: sql`${reminders.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(reminders.id, params.reminderId),
          eq(reminders.userId, params.userId),
          eq(reminders.status, "scheduled"),
          eq(reminders.version, params.expectedVersion)
        )
      )
      .returning();

    return cancelled ?? null;
  }

  async cancelActiveForTarget(
    params: {
      userId: string;
      taskId?: string | null;
      noteId?: string | null;
    },
    executor: DbExecutor = this.database
  ): Promise<Array<{ id: string; userId: string; version: number }>> {
    const targetPredicate = params.taskId
      ? eq(reminders.taskId, params.taskId)
      : params.noteId
        ? eq(reminders.noteId, params.noteId)
        : null;

    if (!targetPredicate) return [];

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
          targetPredicate,
          inArray(reminders.status, ACTIVE_REMINDER_STATUSES)
        )
      )
      .returning({
        id: reminders.id,
        userId: reminders.userId,
        version: reminders.version,
      });
  }

  async findActiveScheduledForTask(
    taskId: string,
    executor: DbExecutor = this.database
  ): Promise<ScheduledReminderCancellationTarget[]> {
    return executor
      .select({
        id: reminders.id,
        userId: reminders.userId,
        version: reminders.version,
      })
      .from(reminders)
      .where(
        and(eq(reminders.taskId, taskId), eq(reminders.status, "scheduled"))
      );
  }

  async findActiveScheduledForNote(
    noteId: string,
    executor: DbExecutor = this.database
  ): Promise<ScheduledReminderCancellationTarget[]> {
    return executor
      .select({
        id: reminders.id,
        userId: reminders.userId,
        version: reminders.version,
      })
      .from(reminders)
      .where(
        and(eq(reminders.noteId, noteId), eq(reminders.status, "scheduled"))
      );
  }

  async findActiveScheduledForProject(
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<ScheduledReminderCancellationTarget[]> {
    const [taskReminders, noteReminders] = await Promise.all([
      executor
        .select({
          id: reminders.id,
          userId: reminders.userId,
          version: reminders.version,
        })
        .from(reminders)
        .innerJoin(tasks, eq(reminders.taskId, tasks.id))
        .where(
          and(
            eq(tasks.projectId, projectId),
            eq(reminders.status, "scheduled")
          )
        ),
      executor
        .select({
          id: reminders.id,
          userId: reminders.userId,
          version: reminders.version,
        })
        .from(reminders)
        .innerJoin(notes, eq(reminders.noteId, notes.id))
        .where(
          and(
            eq(notes.projectId, projectId),
            eq(reminders.status, "scheduled")
          )
        ),
    ]);

    return [...taskReminders, ...noteReminders];
  }

  async findActiveScheduledForUserAccountDeletion(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<ScheduledReminderCancellationTarget[]> {
    const ownedProjects = await executor
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, userId));

    const ownedProjectIds = ownedProjects.map((p) => p.id);

    const [directUserReminders, ownedProjectTaskReminders, ownedProjectNoteReminders] =
      await Promise.all([
        executor
          .select({
            id: reminders.id,
            userId: reminders.userId,
            version: reminders.version,
          })
          .from(reminders)
          .where(
            and(
              eq(reminders.userId, userId),
              eq(reminders.status, "scheduled")
            )
          ),
        ownedProjectIds.length > 0
          ? executor
              .select({
                id: reminders.id,
                userId: reminders.userId,
                version: reminders.version,
              })
              .from(reminders)
              .innerJoin(tasks, eq(reminders.taskId, tasks.id))
              .where(
                and(
                  inArray(tasks.projectId, ownedProjectIds),
                  eq(reminders.status, "scheduled")
                )
              )
          : Promise.resolve([]),
        ownedProjectIds.length > 0
          ? executor
              .select({
                id: reminders.id,
                userId: reminders.userId,
                version: reminders.version,
              })
              .from(reminders)
              .innerJoin(notes, eq(reminders.noteId, notes.id))
              .where(
                and(
                  inArray(notes.projectId, ownedProjectIds),
                  eq(reminders.status, "scheduled")
                )
              )
          : Promise.resolve([]),
      ]);

    // Deduplicate by reminder ID
    const deduped = new Map<string, ScheduledReminderCancellationTarget>();
    for (const row of [
      ...directUserReminders,
      ...ownedProjectTaskReminders,
      ...ownedProjectNoteReminders,
    ]) {
      deduped.set(row.id, row);
    }
    return Array.from(deduped.values());
  }

  async findPendingFarWithinHorizon(
    cutoffUtcMs: number,
    limit = 200
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
      .orderBy(asc(reminders.remindAt), asc(reminders.id))
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
        dispatchedAt: null,
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

  async findUndispatchedScheduled(
    staleBeforeUtcMs: number,
    limit = 200
  ): Promise<ReminderRecord[]> {
    return this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "scheduled"),
          isNull(reminders.dispatchedAt),
          lte(reminders.updatedAt, staleBeforeUtcMs)
        )
      )
      .orderBy(asc(reminders.updatedAt), asc(reminders.id))
      .limit(limit);
  }

  async getEntitySummary(
    target: ReminderTarget,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<{ title: string; snippet: string; deepLink: string } | null> {
    const canRead = await canUserReadEntity(userId, target, executor);
    if (!canRead) return null;

    if (target.taskId) {
      const [task] = await executor
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          projectId: tasks.projectId,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, target.taskId),
            or(
              and(isNull(tasks.projectId), eq(tasks.userId, userId)),
              sql`${tasks.projectId} IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`
            )
          )
        )
        .limit(1);

      if (!task) return null;

      const snippet = (task.description ?? "").trim().slice(0, 140);
      return {
        title: task.title,
        snippet: snippet || "Scheduled task reminder.",
        deepLink: task.projectId
          ? `/app/projects/${encodeURIComponent(task.projectId)}?item=${encodeURIComponent(task.id)}`
          : `/app/inbox?item=${encodeURIComponent(task.id)}`,
      };
    }

    if (target.noteId) {
      const [note] = await executor
        .select({
          id: notes.id,
          title: notes.title,
          content: notes.content,
          projectId: notes.projectId,
        })
        .from(notes)
        .where(
          and(
            eq(notes.id, target.noteId),
            or(
              and(isNull(notes.projectId), eq(notes.userId, userId)),
              sql`${notes.projectId} IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`
            )
          )
        )
        .limit(1);

      if (!note) return null;

      const snippet = note.content
        .replace(/[#*_`>\-\[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);

      return {
        title: note.title,
        snippet: snippet || "Scheduled note reminder.",
        deepLink: note.projectId
          ? `/app/projects/${encodeURIComponent(note.projectId)}?tab=notes&item=${encodeURIComponent(note.id)}`
          : `/app/notes?item=${encodeURIComponent(note.id)}`,
      };
    }

    return null;
  }
}

export const reminderRepository: ReminderRepository =
  new DrizzleReminderRepository(db);
