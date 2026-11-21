import { generatePositionBetween } from "@/lib/fractional-index";
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
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import {
  taskRepository,
  type TaskRepository,
} from "@/server/dal/task-repository";
import { db, type AppDatabase } from "@/server/db";
import type {
  ReminderRecord,
  TaskPriority,
  TaskRecord,
  TaskStatus,
} from "@/server/db/schema";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultPermissionCache,
  type PermissionCache,
} from "@/server/providers/redis/permission-cache";
import { ReminderService } from "./reminder-service";

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
  membershipLookup?: ProjectMembershipLookup;
  permissionCache?: PermissionCache;
  reminderService?: ReminderService;
  eventBus?: EventBus;
}

export class TaskService {
  private readonly database: AppDatabase;
  private readonly tasks: TaskRepository;
  private readonly reminders: ReminderRepository;
  private readonly projects: ProjectRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly permissionCache: PermissionCache;
  private readonly reminderService: ReminderService;
  private readonly eventBus: EventBus;

  constructor(deps: TaskServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.tasks = deps.tasks ?? taskRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.projects = deps.projects ?? projectRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.permissionCache = deps.permissionCache ?? defaultPermissionCache;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.reminderService =
      deps.reminderService ??
      new ReminderService({
        database: this.database,
        reminders: this.reminders,
        tasks: this.tasks,
        membershipLookup: this.membershipLookup,
        permissionCache: this.permissionCache,
        eventBus: this.eventBus,
      });
  }

  private async assertCanMutateTask(
    task: TaskRecord,
    userId: string
  ): Promise<void> {
    if (task.projectId) {
      await assertProjectRole(
        task.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        this.permissionCache
      );
      return;
    }

    if (task.userId !== userId) {
      throw new ForbiddenError();
    }
  }

  private async validateAssignee(
    projectId: string | null | undefined,
    assigneeId: string | null | undefined
  ): Promise<void> {
    if (!assigneeId) return;
    if (!projectId) {
      throw new ValidationError(
        "Assignees can only be set on tasks belonging to a project."
      );
    }
    const member = await this.membershipLookup.findMembership(
      projectId,
      assigneeId
    );
    if (!member) {
      throw new ValidationError("Assignee must be a member of this project.");
    }
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
        this.membershipLookup,
        this.permissionCache
      );
    }
    await this.validateAssignee(input.projectId, input.assigneeId);

    const { task, reminder, postCommitEvent } = await this.database.transaction(
      async (tx) => {
        const lastPos = await this.tasks.getLastPositionForUser(
          userId,
          input.projectId ?? null,
          tx
        );
        const position = generatePositionBetween(lastPos, null);

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
        let eventToEmit: AppDomainEvent | null = null;

        if (input.remindAt !== undefined && input.remindAt !== null) {
          const attached = await this.reminderService.createInTransaction(
            tx,
            userId,
            {
              entityType: "task",
              entityId: createdTask.id,
              remindAt: input.remindAt,
              timezone: input.timezone ?? "UTC",
            }
          );
          createdReminder = attached.reminder;
          eventToEmit = attached.postCommitEvent;
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
          postCommitEvent: eventToEmit,
        };
      }
    );

    if (postCommitEvent) {
      await this.eventBus.emit(postCommitEvent);
    }

    return { task, reminder };
  }

  async toggleTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    options: { cancelPendingReminders?: boolean } = {}
  ): Promise<{ task: TaskRecord; cancelledReminderCount: number }> {
    const cancelPendingReminders = options.cancelPendingReminders ?? true;

    const existing = await this.tasks.getById(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const { updatedTask, cancelledEvents } = await this.database.transaction(
      async (tx) => {
        const completedAt = nextStatus === "done" ? Date.now() : null;
        const updated = await this.tasks.updateById(
          taskId,
          { status: nextStatus, completedAt },
          tx
        );

        if (!updated) {
          throw new NotFoundError("Task not found.");
        }

        const events: AppDomainEvent[] = [];

        if (
          cancelPendingReminders &&
          (nextStatus === "done" || nextStatus === "archived")
        ) {
          const cancelled = await this.reminders.cancelActiveForEntity(
            {
              userId,
              entityType: "task",
              entityId: taskId,
            },
            tx
          );

          for (const row of cancelled) {
            events.push({
              name: "app/reminder.cancelled",
              data: {
                reminderId: row.id,
                userId,
                version: row.version,
              },
            });
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
      }
    );

    if (cancelledEvents.length > 0) {
      await this.eventBus.emit(cancelledEvents);
    }

    return {
      task: updatedTask,
      cancelledReminderCount: cancelledEvents.length,
    };
  }

  async updateTask(
    userId: string,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<TaskRecord> {
    if (input.title !== undefined && !input.title.trim()) {
      throw new ValidationError("Task title cannot be empty.");
    }

    const existing = await this.tasks.getById(taskId);
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
        this.membershipLookup,
        this.permissionCache
      );
    }
    if (input.assigneeId !== undefined) {
      await this.validateAssignee(targetProjectId, input.assigneeId);
    }

    const { updatedTask, cancelledEvents } = await this.database.transaction(
      async (tx) => {
        const completedAt =
          input.status !== undefined
            ? input.status === "done"
              ? existing.completedAt ?? Date.now()
              : null
            : undefined;

        const updated = await this.tasks.updateById(
          taskId,
          {
            ...(input.title !== undefined ? { title: input.title.trim() } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(completedAt !== undefined ? { completedAt } : {}),
            ...(input.priority !== undefined
              ? { priority: input.priority }
              : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
            ...(input.projectId !== undefined
              ? { projectId: input.projectId }
              : {}),
            ...(input.assigneeId !== undefined
              ? { assigneeId: input.assigneeId }
              : {}),
          },
          tx
        );

        if (!updated) {
          throw new NotFoundError("Task not found.");
        }

        const events: AppDomainEvent[] = [];
        if (input.status === "done" || input.status === "archived") {
          const cancelled = await this.reminders.cancelActiveForEntity(
            { userId, entityType: "task", entityId: taskId },
            tx
          );
          for (const row of cancelled) {
            events.push({
              name: "app/reminder.cancelled",
              data: { reminderId: row.id, userId, version: row.version },
            });
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
      }
    );

    if (cancelledEvents.length > 0) {
      await this.eventBus.emit(cancelledEvents);
    }

    return updatedTask;
  }

  async reorderTask(
    userId: string,
    taskId: string,
    bounds: { prevPosition?: string | null; nextPosition?: string | null }
  ): Promise<TaskRecord> {
    const existing = await this.tasks.getById(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const nextPosition = generatePositionBetween(
      bounds.prevPosition ?? null,
      bounds.nextPosition ?? null
    );

    const updated = await this.tasks.updateById(taskId, {
      position: nextPosition,
    });

    if (!updated) {
      throw new NotFoundError("Task not found.");
    }

    return updated;
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const existing = await this.tasks.getById(taskId);
    if (!existing) {
      throw new NotFoundError("Task not found.");
    }
    await this.assertCanMutateTask(existing, userId);

    const cancelledEvents = await this.database.transaction(async (tx) => {
      const cancelled = await this.reminders.cancelActiveForEntity(
        { userId, entityType: "task", entityId: taskId },
        tx
      );

      await this.tasks.deleteById(taskId, tx);

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

      return cancelled.map<AppDomainEvent>((row) => ({
        name: "app/reminder.cancelled",
        data: {
          reminderId: row.id,
          userId,
          version: row.version,
        },
      }));
    });

    if (cancelledEvents.length > 0) {
      await this.eventBus.emit(cancelledEvents);
    }
  }
}

export const taskService = new TaskService();
