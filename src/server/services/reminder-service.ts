import {
  computeSnoozeTargetUtcMs,
  type SnoozePreset,
} from "@/lib/reminder-presets";
import { canUserReadEntity } from "@/server/dal/auth-guard";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  ReminderEntityType,
  ReminderRecord,
  ReminderStatus,
  ReminderTarget,
} from "@/server/db/schema";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import { isValidIanaTimezone } from "./user-preferences-service";

export const REMINDER_HORIZON_DAYS = 14;
export const REMINDER_HORIZON_MS = REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_SWEEPER_BATCH_SIZE = 200;
export const DEFAULT_OUTBOX_MIN_AGE_MS = 60_000;

export function computeReminderHorizonStatus(
  remindAtUtcMs: number,
  nowMs: number = Date.now()
): Extract<ReminderStatus, "scheduled" | "pending_far"> {
  return remindAtUtcMs <= nowMs + REMINDER_HORIZON_MS
    ? "scheduled"
    : "pending_far";
}

export function buildScheduledReminderEvent(
  reminder: Pick<
    ReminderRecord,
    "id" | "userId" | "taskId" | "noteId" | "remindAt" | "version"
  >
): AppDomainEvent {
  return {
    id: `reminder-sched-${reminder.id}-v${reminder.version}`,
    name: "app/reminder.scheduled",
    data: {
      reminderId: reminder.id,
      userId: reminder.userId,
      taskId: reminder.taskId,
      noteId: reminder.noteId,
      remindAt: reminder.remindAt,
      version: reminder.version,
    },
  };
}

export function buildCancelledReminderEvent(params: {
  reminderId: string;
  userId: string;
  version: number;
}): AppDomainEvent {
  return {
    id: `reminder-cancel-${params.reminderId}-v${params.version}`,
    name: "app/reminder.cancelled",
    data: {
      reminderId: params.reminderId,
      userId: params.userId,
      version: params.version,
    },
  };
}

export type AttachReminderInput =
  | {
      taskId: string;
      noteId?: null;
      remindAt: number;
      timezone: string;
    }
  | {
      noteId: string;
      taskId?: null;
      remindAt: number;
      timezone: string;
    }
  | {
      entityType: ReminderEntityType;
      entityId: string;
      remindAt: number;
      timezone: string;
    };

function normalizeTarget(input: AttachReminderInput): ReminderTarget {
  if ("taskId" in input && input.taskId) {
    return { taskId: input.taskId, noteId: null };
  }
  if ("noteId" in input && input.noteId) {
    return { noteId: input.noteId, taskId: null };
  }
  if ("entityType" in input) {
    return input.entityType === "task"
      ? { taskId: input.entityId, noteId: null }
      : { noteId: input.entityId, taskId: null };
  }
  throw new ValidationError("Reminder must target either a task or a note.");
}

export interface RescheduleReminderInput {
  remindAt: number;
  timezone: string;
  expectedVersion?: number;
}

export interface ReminderServiceDeps {
  database?: AppDatabase;
  reminders?: ReminderRepository;
  eventBus?: EventBus;
  now?: () => number;
}

export class ReminderService {
  private readonly database: AppDatabase;
  private readonly reminders: ReminderRepository;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: ReminderServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.reminders = deps.reminders ?? reminderRepository;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Emits a deterministic `app/reminder.scheduled` event post-commit and stamps
   * `dispatched_at` on success. If the event bus fails transiently, the row
   * remains safely committed with `dispatched_at = NULL` for the 5-minute
   * Outbox Reconciliation cron to recover.
   */
  async dispatchScheduledReminder(reminder: ReminderRecord): Promise<boolean> {
    if (reminder.status !== "scheduled") return false;

    const event = buildScheduledReminderEvent(reminder);
    try {
      await this.eventBus.emit(event);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "reminder.outbox.dispatch_deferred",
          reminderId: reminder.id,
          version: reminder.version,
          reason: error instanceof Error ? error.message : "Unknown error",
        })
      );
      return false;
    }

    await withDbRetry(() =>
      this.reminders.markDispatched({
        reminderId: reminder.id,
        expectedVersion: reminder.version,
        dispatchedAt: this.now(),
      })
    );

    return true;
  }

  /**
   * Best-effort emission for cancellation/reschedule control signals after DB
   * commit (the DB version increment already guarantees stale runs cannot fire).
   */
  async emitControlEventsSafely(events: AppDomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.eventBus.emit(events);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "reminder.control_event.emit_failed",
          count: events.length,
          reason: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }

  /**
   * Inserts a reminder inside an existing ACID transaction with `dispatched_at = NULL`.
   * Callers MUST invoke `dispatchScheduledReminder(reminder)` AFTER transaction commit.
   */
  async createInTransaction(
    tx: DbExecutor,
    userId: string,
    input: AttachReminderInput
  ): Promise<{ reminder: ReminderRecord; shouldDispatch: boolean }> {
    if (!Number.isFinite(input.remindAt) || input.remindAt <= 0) {
      throw new ValidationError("Reminder time must be a valid UTC timestamp.");
    }
    const target = normalizeTarget(input);
    const timezone = isValidIanaTimezone(input.timezone)
      ? input.timezone
      : "UTC";

    const status = computeReminderHorizonStatus(input.remindAt, this.now());
    const reminder = await this.reminders.create(
      {
        userId,
        taskId: target.taskId ?? null,
        noteId: target.noteId ?? null,
        remindAt: input.remindAt,
        timezone,
        status,
      },
      tx
    );

    return {
      reminder,
      shouldDispatch: status === "scheduled",
    };
  }

  /**
   * Attaches a private personal reminder for `userId`.
   * Enforces centralized `canUserReadEntity()` directly against Turso (blocks IDOR).
   */
  async attachReminder(
    userId: string,
    input: AttachReminderInput
  ): Promise<ReminderRecord> {
    if (!Number.isFinite(input.remindAt) || input.remindAt <= 0) {
      throw new ValidationError("Reminder time must be a valid UTC timestamp.");
    }

    const target = normalizeTarget(input);
    const allowed = await canUserReadEntity(userId, target, this.database);
    if (!allowed) {
      throw new ForbiddenError();
    }

    const result = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        // Re-verify inside transaction to prevent TOCTOU if access was just revoked
        const stillAllowed = await canUserReadEntity(userId, target, tx);
        if (!stillAllowed) {
          throw new ForbiddenError();
        }
        return this.createInTransaction(tx, userId, {
          ...target,
          remindAt: input.remindAt,
          timezone: input.timezone,
        } as AttachReminderInput);
      })
    );

    if (result.shouldDispatch) {
      await this.dispatchScheduledReminder(result.reminder);
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

    const updated = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.reminders.getByIdForUser(
          reminderId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Reminder not found.");
        }

        const stillAllowed = await canUserReadEntity(
          userId,
          { taskId: existing.taskId, noteId: existing.noteId },
          tx
        );
        if (!stillAllowed) {
          throw new ForbiddenError();
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
            dispatchedAt: null,
            sentAt: null,
          },
          tx
        );

        if (!next) {
          throw new ConflictError(
            "Reminder was modified concurrently. Please refresh and try again."
          );
        }

        return next;
      })
    );

    await this.emitControlEventsSafely([
      {
        id: `reminder-resched-${updated.id}-v${updated.version}`,
        name: "app/reminder.rescheduled",
        data: {
          reminderId: updated.id,
          userId: updated.userId,
          version: updated.version,
        },
      },
    ]);

    if (updated.status === "scheduled") {
      await this.dispatchScheduledReminder(updated);
    }

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
    const cancelled = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
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
      })
    );

    await this.emitControlEventsSafely([
      buildCancelledReminderEvent({
        reminderId: cancelled.id,
        userId: cancelled.userId,
        version: cancelled.version,
      }),
    ]);

    return cancelled;
  }

  /**
   * Single atomic conditional UPDATE claiming a scheduled reminder for delivery.
   * Returns `null` if another worker claimed it or the reminder was edited/cancelled.
   */
  async verifyAndClaimForDelivery(
    reminderId: string,
    userId: string,
    expectedVersion: number
  ): Promise<ReminderRecord | null> {
    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        return this.reminders.claimForDelivery(
          {
            reminderId,
            userId,
            expectedVersion,
            sentAt: this.now(),
          },
          tx
        );
      })
    );
  }

  async cancelForRevokedAccess(
    reminderId: string,
    userId: string,
    expectedVersion: number
  ): Promise<ReminderRecord | null> {
    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        return this.reminders.cancelIfRevoked(
          {
            reminderId,
            userId,
            expectedVersion,
            nowMs: this.now(),
          },
          tx
        );
      })
    );
  }

  /**
   * Bounded batch sweeper (default LIMIT 200) promoting `pending_far` rows
   * entering the 14-day window to `scheduled`, emitting batched deterministic
   * events, and stamping `dispatched_at`.
   */
  async sweepFarFutureReminders(
    batchSize = DEFAULT_SWEEPER_BATCH_SIZE
  ): Promise<number> {
    const cutoff = this.now() + REMINDER_HORIZON_MS;
    const candidates = await this.reminders.findPendingFarWithinHorizon(
      cutoff,
      batchSize
    );

    if (candidates.length === 0) {
      return 0;
    }

    const promotedRows = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const rows: ReminderRecord[] = [];
        for (const candidate of candidates) {
          const promoted = await this.reminders.promotePendingFarToScheduled(
            candidate.id,
            candidate.version,
            tx
          );
          if (promoted) {
            rows.push(promoted);
          }
        }
        return rows;
      })
    );

    if (promotedRows.length === 0) {
      return 0;
    }

    const batchEvents = promotedRows.map((row) =>
      buildScheduledReminderEvent(row)
    );

    try {
      await this.eventBus.emit(batchEvents);
    } catch (error) {
      // Leave `dispatched_at = NULL` so the 5-minute Outbox Reconciliation cron retries
      console.warn(
        JSON.stringify({
          event: "reminder.sweeper.batch_emit_deferred",
          count: promotedRows.length,
          reason: error instanceof Error ? error.message : "Unknown error",
        })
      );
      return promotedRows.length;
    }

    const stampedAt = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        for (const row of promotedRows) {
          await this.reminders.markDispatched(
            {
              reminderId: row.id,
              expectedVersion: row.version,
              dispatchedAt: stampedAt,
            },
            tx
          );
        }
      })
    );

    return promotedRows.length;
  }

  /**
   * Outbox Reconciliation batch worker (LIMIT 200): finds `scheduled` rows whose
   * post-commit `inngest.send()` failed (`dispatched_at IS NULL` and older than
   * `minAgeMs`), emits batched deterministic events, and stamps `dispatched_at`.
   */
  async reconcileUndispatchedBatch(
    batchSize = DEFAULT_SWEEPER_BATCH_SIZE,
    minAgeMs = DEFAULT_OUTBOX_MIN_AGE_MS
  ): Promise<number> {
    const staleBefore = this.now() - minAgeMs;
    const undispatched = await this.reminders.findUndispatchedScheduled(
      staleBefore,
      batchSize
    );

    if (undispatched.length === 0) {
      return 0;
    }

    const events = undispatched.map((row) => buildScheduledReminderEvent(row));
    await this.eventBus.emit(events);

    const stampedAt = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        for (const row of undispatched) {
          await this.reminders.markDispatched(
            {
              reminderId: row.id,
              expectedVersion: row.version,
              dispatchedAt: stampedAt,
            },
            tx
          );
        }
      })
    );

    return undispatched.length;
  }
}

export const reminderService = new ReminderService();
