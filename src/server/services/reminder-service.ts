import {
  computeSnoozeTargetUtcMs,
  type SnoozePreset,
} from "@/lib/reminder-presets";
import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { noteRepository, type NoteRepository } from "@/server/dal/note-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { taskRepository, type TaskRepository } from "@/server/dal/task-repository";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  ReminderEntityType,
  ReminderRecord,
  ReminderStatus,
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
import { isValidIanaTimezone } from "./user-preferences-service";

export const REMINDER_HORIZON_DAYS = 14;
export const REMINDER_HORIZON_MS = REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;

export function computeReminderHorizonStatus(
  remindAtUtcMs: number,
  nowMs: number = Date.now()
): Extract<ReminderStatus, "scheduled" | "pending_far"> {
  return remindAtUtcMs <= nowMs + REMINDER_HORIZON_MS
    ? "scheduled"
    : "pending_far";
}

export interface AttachReminderInput {
  entityType: ReminderEntityType;
  entityId: string;
  remindAt: number;
  timezone: string;
}

export interface RescheduleReminderInput {
  remindAt: number;
  timezone: string;
  expectedVersion?: number;
}

export interface ReminderServiceDeps {
  database?: AppDatabase;
  reminders?: ReminderRepository;
  tasks?: TaskRepository;
  notes?: NoteRepository;
  membershipLookup?: ProjectMembershipLookup;
  permissionCache?: PermissionCache;
  eventBus?: EventBus;
  now?: () => number;
}

export class ReminderService {
  private readonly database: AppDatabase;
  private readonly reminders: ReminderRepository;
  private readonly tasks: TaskRepository;
  private readonly notes: NoteRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly permissionCache: PermissionCache;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: ReminderServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.reminders = deps.reminders ?? reminderRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.notes = deps.notes ?? noteRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.permissionCache = deps.permissionCache ?? defaultPermissionCache;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Inserts a reminder inside an existing ACID transaction and returns any post-commit
   * domain event that MUST be emitted only after the enclosing transaction succeeds.
   */
  async createInTransaction(
    tx: DbExecutor,
    userId: string,
    input: AttachReminderInput
  ): Promise<{ reminder: ReminderRecord; postCommitEvent: AppDomainEvent | null }> {
    if (!Number.isFinite(input.remindAt) || input.remindAt <= 0) {
      throw new ValidationError("Reminder time must be a valid UTC timestamp.");
    }
    const timezone = isValidIanaTimezone(input.timezone)
      ? input.timezone
      : "UTC";

    const status = computeReminderHorizonStatus(input.remindAt, this.now());
    const reminder = await this.reminders.create(
      {
        userId,
        entityType: input.entityType,
        entityId: input.entityId,
        remindAt: input.remindAt,
        timezone,
        status,
      },
      tx
    );

    const postCommitEvent: AppDomainEvent | null =
      status === "scheduled"
        ? {
            name: "app/reminder.scheduled",
            data: {
              reminderId: reminder.id,
              userId: reminder.userId,
              entityType: reminder.entityType,
              entityId: reminder.entityId,
              remindAt: reminder.remindAt,
              version: reminder.version,
            },
          }
        : null;

    return { reminder, postCommitEvent };
  }

  /**
   * Attaches a private personal reminder for `userId`.
   * - Personal items: creator ONLY.
   * - Project items: ANY project member (`owner`, `editor`, or `viewer`) can attach
   *   their own private personal reminder without mutating shared project state.
   */
  async attachReminder(
    userId: string,
    input: AttachReminderInput
  ): Promise<ReminderRecord> {
    if (!Number.isFinite(input.remindAt) || input.remindAt <= 0) {
      throw new ValidationError("Reminder time must be a valid UTC timestamp.");
    }

    if (input.entityType === "task") {
      const task = await this.tasks.getById(input.entityId);
      if (!task) {
        throw new NotFoundError("Task not found.");
      }
      if (task.projectId) {
        await assertProjectRole(
          task.projectId,
          userId,
          ["owner", "editor", "viewer"],
          this.membershipLookup,
          this.permissionCache
        );
      } else if (task.userId !== userId) {
        throw new ForbiddenError();
      }
    } else {
      const note = await this.notes.getById(input.entityId);
      if (!note) {
        throw new NotFoundError("Note not found.");
      }
      if (note.projectId) {
        await assertProjectRole(
          note.projectId,
          userId,
          ["owner", "editor", "viewer"],
          this.membershipLookup,
          this.permissionCache
        );
      } else if (note.userId !== userId) {
        throw new ForbiddenError();
      }
    }

    const result = await this.database.transaction(async (tx) => {
      return this.createInTransaction(tx, userId, input);
    });

    if (result.postCommitEvent) {
      await this.eventBus.emit(result.postCommitEvent);
    }

    return result.reminder;
  }

  async rescheduleReminder(
    userId: string,
    reminderId: string,
    input: RescheduleReminderInput
  ): Promise<ReminderRecord> {
    if (!Number.isFinite(input.remindAt) || input.remindAt <= 0) {
      throw new ValidationError("Reminder time must be a valid UTC timestamp.");
    }
    const timezone = isValidIanaTimezone(input.timezone)
      ? input.timezone
      : "UTC";

    const { updated, events } = await this.database.transaction(async (tx) => {
      const existing = await this.reminders.getByIdForUser(
        reminderId,
        userId,
        tx
      );
      if (!existing) {
        throw new NotFoundError("Reminder not found.");
      }

      const expectedVersion = input.expectedVersion ?? existing.version;
      const nextStatus = computeReminderHorizonStatus(
        input.remindAt,
        this.now()
      );

      const next = await this.reminders.updateWithVersion(
        {
          reminderId,
          userId,
          expectedVersion,
          remindAt: input.remindAt,
          timezone,
          status: nextStatus,
          sentAt: null,
        },
        tx
      );

      if (!next) {
        throw new ConflictError(
          "Reminder was modified concurrently. Please refresh and try again."
        );
      }

      const outEvents: AppDomainEvent[] = [
        {
          name: "app/reminder.rescheduled",
          data: {
            reminderId: next.id,
            userId: next.userId,
            version: next.version,
          },
        },
      ];

      if (next.status === "scheduled") {
        outEvents.push({
          name: "app/reminder.scheduled",
          data: {
            reminderId: next.id,
            userId: next.userId,
            entityType: next.entityType,
            entityId: next.entityId,
            remindAt: next.remindAt,
            version: next.version,
          },
        });
      }

      return { updated: next, events: outEvents };
    });

    await this.eventBus.emit(events);
    return updated;
  }

  async snoozeReminder(
    userId: string,
    reminderId: string,
    preset: SnoozePreset,
    timezone: string,
    expectedVersion?: number
  ): Promise<ReminderRecord> {
    const targetUtcMs = computeSnoozeTargetUtcMs(preset, timezone, this.now());
    return this.rescheduleReminder(userId, reminderId, {
      remindAt: targetUtcMs,
      timezone,
      expectedVersion,
    });
  }

  async cancelReminder(
    userId: string,
    reminderId: string,
    expectedVersion?: number
  ): Promise<ReminderRecord> {
    const cancelled = await this.database.transaction(async (tx) => {
      const existing = await this.reminders.getByIdForUser(
        reminderId,
        userId,
        tx
      );
      if (!existing) {
        throw new NotFoundError("Reminder not found.");
      }

      const targetVersion = expectedVersion ?? existing.version;
      const updated = await this.reminders.updateWithVersion(
        {
          reminderId,
          userId,
          expectedVersion: targetVersion,
          status: "cancelled",
        },
        tx
      );

      if (!updated) {
        throw new ConflictError(
          "Reminder was modified concurrently. Please refresh and try again."
        );
      }

      return updated;
    });

    await this.eventBus.emit({
      name: "app/reminder.cancelled",
      data: {
        reminderId: cancelled.id,
        userId: cancelled.userId,
        version: cancelled.version,
      },
    });

    return cancelled;
  }

  async verifyAndClaimForDelivery(
    reminderId: string,
    expectedVersion: number
  ): Promise<ReminderRecord | null> {
    return this.database.transaction(async (tx) => {
      return this.reminders.claimForDelivery(
        {
          reminderId,
          expectedVersion,
          sentAt: this.now(),
        },
        tx
      );
    });
  }

  async sweepFarFutureReminders(batchSize = 100): Promise<number> {
    const cutoff = this.now() + REMINDER_HORIZON_MS;
    const candidates = await this.reminders.findPendingFarWithinHorizon(
      cutoff,
      batchSize
    );

    if (candidates.length === 0) {
      return 0;
    }

    const promotedEvents: AppDomainEvent[] = [];

    for (const candidate of candidates) {
      const promoted = await this.database.transaction(async (tx) => {
        return this.reminders.promotePendingFarToScheduled(
          candidate.id,
          candidate.version,
          tx
        );
      });

      if (promoted) {
        promotedEvents.push({
          name: "app/reminder.scheduled",
          data: {
            reminderId: promoted.id,
            userId: promoted.userId,
            entityType: promoted.entityType,
            entityId: promoted.entityId,
            remindAt: promoted.remindAt,
            version: promoted.version,
          },
        });
      }
    }

    if (promotedEvents.length > 0) {
      await this.eventBus.emit(promotedEvents);
    }

    return promotedEvents.length;
  }
}

export const reminderService = new ReminderService();
