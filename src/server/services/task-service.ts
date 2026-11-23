import {
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import {
  taskRepository,
  type TaskAuthMetadata,
  type TaskRepository,
  type TaskScope,
} from "@/server/dal/task-repository";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  ReminderRecord,
  TaskPriority,
  TaskRecord,
  TaskStatus,
} from "@/server/db/schema";
import { computeIsBackfilledLate } from "@/server/domain/habit-analytics";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  buildCancelledReminderEvent,
  ReminderService,
} from "./reminder-service";

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueAt?: number | null;
  projectId?: string | null;
  assigneeId?: string | null;
  remindAt?: number | null;
  timezone?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: number | null;
  projectId?: string | null;
  assigneeId?: string | null;
}

export interface TaskServiceDeps {
  database?: AppDatabase;
  tasks?: TaskRepository;
  reminders?: ReminderRepository;
  projects?: ProjectRepository;
  habits?: HabitRepository;
  users?: UserRepository;
  membershipLookup?: ProjectMembershipLookup;
  reminderService?: ReminderService;
  eventBus?: EventBus;
}

export class TaskService {
  private readonly database: AppDatabase;
  private readonly tasks: TaskRepository;
  private readonly reminders: ReminderRepository;
  private readonly projects: ProjectRepository;
  private readonly habits: HabitRepository;
  private readonly users: UserRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly reminderService: ReminderService;
  private readonly eventBus: EventBus;

  constructor(deps: TaskServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.tasks = deps.tasks ?? taskRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.projects = deps.projects ?? projectRepository;
    this.habits = deps.habits ?? habitRepository;
    this.users = deps.users ?? userRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.reminderService =
      deps.reminderService ??
      new ReminderService({
        database: this.database,
        reminders: this.reminders,
        eventBus: this.eventBus,
      });
  }

  /**
   * Synchronizes a task's linked habit log inside the active SQLite transaction
   * whenever a task owned by `userId` transitions into or out of `'done'`.
   */
  private async syncHabitLogInTransaction(
    tx: DbExecutor,
    params: {
      userId: string;
      existing: Pick<
        TaskAuthMetadata,
        "userId" | "habitId" | "habitDateKey" | "status"
      >;
      nextStatus: TaskStatus;
      nowMs: number;
      timezone?: string;
    }
  ): Promise<void> {
    const { existing, userId, nextStatus, nowMs } = params;
    if (
      !existing.habitId ||
      !existing.habitDateKey ||
      existing.userId !== userId
    ) {
      return;
    }

    const habit = await this.habits.getHabitForUser(userId, existing.habitId, tx);
    if (!habit) {
      return;
    }

    if (nextStatus === "done") {
      const tz =
        params.timezone ??
        (await this.users.getById(userId, tx))?.timezone ??
        "UTC";
      const existingLog = await this.habits.getLogForHabitDay(
        userId,
        habit.id,
        existing.habitDateKey,
        tx
      );
      const isBackfilledLate = computeIsBackfilledLate(
        existing.habitDateKey,
        nowMs,
        tz
      );
      await this.habits.upsertLog(
        {
          habitId: habit.id,
          userId,
          dateKey: existing.habitDateKey,
          status: "done",
          note: existingLog?.note ?? null,
          loggedAt: nowMs,
          isBackfilledLate,
        },
        tx
      );
    } else if (
      existing.status === "done" &&
      (nextStatus === "todo" || nextStatus === "in_progress")
    ) {
      await this.habits.deleteLogForUser(
        userId,
        habit.id,
        existing.habitDateKey,
        tx
      );
    }
  }

  private async assertCanMutateTask(
    task: Pick<TaskAuthMetadata, "userId" | "projectId">,
    userId: string,
    executor?: DbExecutor
  ): Promise<void> {
    if (task.projectId) {
      await assertProjectRole(
        task.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        executor
      );
      return;
    }

    if (task.userId !== userId) {
      throw new ForbiddenError();
    }
  }

  private async validateAssignee(
    projectId: string | null | undefined,
    assigneeId: string | null | undefined,
    executor?: DbExecutor
  ): Promise<void> {
    if (!assigneeId) return;
    if (!projectId) {
      throw new ValidationError(
        "Assignees can only be set on tasks belonging to a project."
      );
    }
    const member = await this.membershipLookup.findMembership(
      projectId,
      assigneeId,
      executor
    );
    if (!member) {
      throw new ValidationError("Assignee must be a member of this project.");
    }
  }

  private taskScope(
    userId: string,
    projectId: string | null | undefined
  ): TaskScope {
    return projectId
      ? { kind: "project", projectId }
      : { kind: "personal", userId };
  }

  async createTask(
    userId: string,
    input: CreateTaskInput
  ): Promise<{ task: TaskRecord; reminder: ReminderRecord | null }> {
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError("Task title cannot be empty.");
    }

    if (input.projectId) {
      await assertProjectRole(
        input.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup
      );
    }
    await this.validateAssignee(input.projectId, input.assigneeId);

    const { task, reminder, shouldDispatch } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const scope = this.taskScope(userId, input.projectId);
        const lastPos = await this.tasks.getLastPositionForScope(scope, tx);
        let position = generatePositionBetween(lastPos, null);

        if (position.length > MAX_POSITION_KEY_LENGTH) {
          await this.tasks.rebalancePositions(scope, tx);
          const refreshedLast = await this.tasks.getLastPositionForScope(
            scope,
            tx
          );
          position = generatePositionBetween(refreshedLast, null);
        }

        const createdTask = await this.tasks.create(
          {
            userId,
            projectId: input.projectId ?? null,
            assigneeId: input.assigneeId ?? null,
            title,
            description: input.description?.trim() || null,
            priority: input.priority ?? "none",
            dueAt: input.dueAt ?? null,
            position,
          },
          tx
        );

        let createdReminder: ReminderRecord | null = null;
        let dispatchReminder = false;

        if (input.remindAt !== undefined && input.remindAt !== null) {
          const attached = await this.reminderService.createInTransaction(
            tx,
            userId,
            {
              taskId: createdTask.id,
              noteId: null,
              remindAt: input.remindAt,
              timezone: input.timezone ?? "UTC",
            }
          );
          createdReminder = attached.reminder;
          dispatchReminder = attached.shouldDispatch;
        }

        if (createdTask.projectId) {
          await this.projects.recordActivity(
            {
              projectId: createdTask.projectId,
              actorId: userId,
              action: "task.created",
              entityType: "task",
              entityId: createdTask.id,
              metadata: { title: createdTask.title },
            },
            tx
          );
        }

        return {
          task: createdTask,
          reminder: createdReminder,
          shouldDispatch: dispatchReminder,
        };
      })
    );

    if (reminder && shouldDispatch) {
      await this.reminderService.dispatchScheduledReminder(reminder);
    }

    return { task, reminder };
  }

  async toggleTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    options: { cancelPendingReminders?: boolean; timezone?: string } = {}
  ): Promise<{ task: TaskRecord; cancelledReminderCount: number }> {
    const cancelPendingReminders = options.cancelPendingReminders ?? true;

    const existing = await this.tasks.getAuthMetadata(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const { updatedTask, cancelledEvents } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const nowMs = Date.now();
        const completedAt = nextStatus === "done" ? nowMs : null;
        const updated = existing.projectId
          ? await this.tasks.updateProjectTask(
              taskId,
              existing.projectId,
              { status: nextStatus, completedAt },
              tx
            )
          : await this.tasks.updatePersonalTask(
              taskId,
              userId,
              { status: nextStatus, completedAt },
              tx
            );

        if (!updated) {
          throw new NotFoundError("Task not found.");
        }

        // Bidirectional ACID Task -> Habit log synchronization
        await this.syncHabitLogInTransaction(tx, {
          userId,
          existing,
          nextStatus,
          nowMs,
          timezone: options.timezone,
        });

        const events: AppDomainEvent[] = [];

        if (
          cancelPendingReminders &&
          (nextStatus === "done" || nextStatus === "archived")
        ) {
          const cancelled = await this.reminders.cancelActiveForTarget(
            {
              userId,
              taskId,
            },
            tx
          );

          for (const row of cancelled) {
            events.push(
              buildCancelledReminderEvent({
                reminderId: row.id,
                userId: row.userId,
                version: row.version,
              })
            );
          }
        }

        if (updated.projectId) {
          await this.projects.recordActivity(
            {
              projectId: updated.projectId,
              actorId: userId,
              action:
                nextStatus === "done" ? "task.completed" : "task.reopened",
              entityType: "task",
              entityId: updated.id,
              metadata: { title: updated.title, status: nextStatus },
            },
            tx
          );
        }

        return { updatedTask: updated, cancelledEvents: events };
      })
    );

    if (cancelledEvents.length > 0) {
      await this.reminderService.emitControlEventsSafely(cancelledEvents);
    }

    return {
      task: updatedTask,
      cancelledReminderCount: cancelledEvents.length,
    };
  }

  async updateTask(
    userId: string,
    taskId: string,
    input: UpdateTaskInput,
    options: { timezone?: string } = {}
  ): Promise<TaskRecord> {
    if (input.title !== undefined && !input.title.trim()) {
      throw new ValidationError("Task title cannot be empty.");
    }

    const existing = await this.tasks.getAuthMetadata(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const targetProjectId =
      input.projectId !== undefined ? input.projectId : existing.projectId;
    if (input.projectId && input.projectId !== existing.projectId) {
      await assertProjectRole(
        input.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup
      );
    }
    if (input.assigneeId !== undefined) {
      await this.validateAssignee(targetProjectId, input.assigneeId);
    }

    const { updatedTask, cancelledEvents } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const nowMs = Date.now();
        const completedAt =
          input.status !== undefined
            ? input.status === "done"
              ? existing.completedAt ?? nowMs
              : null
            : undefined;

        const patch = {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(completedAt !== undefined ? { completedAt } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.projectId !== undefined
            ? { projectId: input.projectId }
            : {}),
          ...(input.assigneeId !== undefined
            ? { assigneeId: input.assigneeId }
            : {}),
        };

        const updated = existing.projectId
          ? await this.tasks.updateProjectTask(
              taskId,
              existing.projectId,
              patch,
              tx
            )
          : await this.tasks.updatePersonalTask(taskId, userId, patch, tx);

        if (!updated) {
          throw new NotFoundError("Task not found.");
        }

        if (input.status !== undefined && input.status !== existing.status) {
          await this.syncHabitLogInTransaction(tx, {
            userId,
            existing,
            nextStatus: input.status,
            nowMs,
            timezone: options.timezone,
          });
        }

        const events: AppDomainEvent[] = [];
        if (input.status === "done" || input.status === "archived") {
          const cancelled = await this.reminders.cancelActiveForTarget(
            { userId, taskId },
            tx
          );
          for (const row of cancelled) {
            events.push(
              buildCancelledReminderEvent({
                reminderId: row.id,
                userId: row.userId,
                version: row.version,
              })
            );
          }
        }

        if (updated.projectId) {
          const assigneeChanged =
            input.assigneeId !== undefined &&
            input.assigneeId !== existing.assigneeId;
          await this.projects.recordActivity(
            {
              projectId: updated.projectId,
              actorId: userId,
              action: assigneeChanged ? "task.assigned" : "task.updated",
              entityType: "task",
              entityId: updated.id,
              metadata: {
                title: updated.title,
                ...(assigneeChanged ? { assigneeId: updated.assigneeId } : {}),
              },
            },
            tx
          );
        }

        return { updatedTask: updated, cancelledEvents: events };
      })
    );

    if (cancelledEvents.length > 0) {
      await this.reminderService.emitControlEventsSafely(cancelledEvents);
    }

    return updatedTask;
  }

  async reorderTask(
    userId: string,
    taskId: string,
    bounds: { prevPosition?: string | null; nextPosition?: string | null }
  ): Promise<TaskRecord> {
    const existing = await this.tasks.getAuthMetadata(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const nextPosition = generatePositionBetween(
      bounds.prevPosition ?? null,
      bounds.nextPosition ?? null
    );

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const updated = existing.projectId
          ? await this.tasks.updateProjectTask(
              taskId,
              existing.projectId,
              { position: nextPosition },
              tx
            )
          : await this.tasks.updatePersonalTask(
              taskId,
              userId,
              { position: nextPosition },
              tx
            );

        if (!updated) {
          throw new NotFoundError("Task not found.");
        }

        // Trigger transactional keyspace rebalancing whenever fractional keys grow beyond 32 chars
        if (nextPosition.length > MAX_POSITION_KEY_LENGTH) {
          const scope = this.taskScope(userId, existing.projectId);
          await this.tasks.rebalancePositions(scope, tx);

          const refreshed = existing.projectId
            ? await this.tasks.updateProjectTask(
                taskId,
                existing.projectId,
                {},
                tx
              )
            : await this.tasks.updatePersonalTask(taskId, userId, {}, tx);

          if (refreshed) {
            return refreshed;
          }
        }

        return updated;
      })
    );
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const existing = await this.tasks.getAuthMetadata(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const cancelledEvents = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        // Collect ALL active scheduled reminders across all users BEFORE cascade delete
        const activeScheduled =
          await this.reminders.findActiveScheduledForTask(taskId, tx);

        const deleted = existing.projectId
          ? await this.tasks.deleteProjectTask(taskId, existing.projectId, tx)
          : await this.tasks.deletePersonalTask(taskId, userId, tx);

        if (!deleted) {
          throw new NotFoundError("Task not found.");
        }

        if (existing.projectId) {
          await this.projects.recordActivity(
            {
              projectId: existing.projectId,
              actorId: userId,
              action: "task.deleted",
              entityType: "task",
              entityId: taskId,
              metadata: { title: existing.title },
            },
            tx
          );
        }

        return activeScheduled.map((row) =>
          buildCancelledReminderEvent({
            reminderId: row.id,
            userId: row.userId,
            version: row.version,
          })
        );
      })
    );

    if (cancelledEvents.length > 0) {
      await this.reminderService.emitControlEventsSafely(cancelledEvents);
    }
  }
}

export const taskService = new TaskService();
