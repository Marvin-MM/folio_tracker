import { inngest } from "@/server/inngest/client";

export type AppDomainEvent =
  | {
      id?: string;
      name: "app/reminder.scheduled";
      data: {
        reminderId: string;
        userId: string;
        taskId: string | null;
        noteId: string | null;
        remindAt: number;
        version: number;
      };
    }
  | {
      id?: string;
      name: "app/reminder.rescheduled";
      data: {
        reminderId: string;
        userId: string;
        version: number;
      };
    }
  | {
      id?: string;
      name: "app/reminder.cancelled";
      data: {
        reminderId: string;
        userId: string;
        version: number;
      };
    }
  | {
      id?: string;
      name: "app/auth.email";
      data: {
        kind: "verification" | "password_reset";
        to: string;
        recipientName: string;
        actionUrl: string;
      };
    }
  | {
      id?: string;
      name: "app/reminder.test";
      data: {
        userId: string;
        timezone: string;
      };
    }
  | {
      id?: string;
      name: "app/project.invited";
      data: {
        invitationId: string;
        projectId: string;
        projectName: string;
        inviterName: string;
        email: string;
        role: "editor" | "viewer";
        inviteUrl: string;
      };
    }
  | {
      id?: string;
      name: "app/habit.nudge";
      data: {
        userId: string;
        dateKey: string;
        slot: string;
        kind: "habit_preferred" | "evening_checkin";
        habitId: string | null;
        dedupKey: string;
        timezone: string;
      };
    }
  | {
      id?: string;
      name: "app/habit.monitor_requested";
      data: {
        requestId: string;
        ownerId: string;
        ownerName: string;
        targetUserId: string;
        scope: "all" | "selected";
      };
    }
  | {
      id?: string;
      name: "app/habit.monitor_invited";
      data: {
        requestId: string;
        ownerId: string;
        ownerName: string;
        targetEmail: string;
        scope: "all" | "selected";
        inviteUrl: string;
      };
    }
  | {
      id?: string;
      name: "app/habit.review_digest";
      data: {
        monitorId: string;
        ownerId: string;
        monitorUserId: string;
        cycleKey: string;
        periodStartDate: string;
        periodEndDate: string;
        dedupKey: string;
      };
    }
  | {
      id?: string;
      name: "app/habit.streak_at_risk";
      data: {
        groupId: string;
        groupName: string;
        ownerId: string;
        ownerName: string;
        ownerTimezone: string;
        recipientId: string;
        recipientName: string;
        recipientTimezone: string;
        habitId: string;
        habitTitle: string;
        dateKey: string;
        currentStreak: number;
        streakUnit: "days" | "weeks";
        reason: "unlogged" | "missed";
        dedupKey: string;
      };
    }
  | {
      id?: string;
      name: "app/habit.comment_posted";
      data: {
        commentId: string;
        ownerId: string;
        authorId: string;
        authorName: string;
        recipientUserId: string;
        cycleKey: string;
        bodyPreview: string;
        deepLink: string;
      };
    };

export interface EventBus {
  emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void>;
}

/**
 * Production EventBus backed by Inngest v4.
 * Supports deterministic `id` keys for 24h deduplication across Outbox retries.
 */
export class InngestEventBus implements EventBus {
  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    const events = Array.isArray(event) ? event : [event];
    if (events.length === 0) return;

    await inngest.send(events);
  }
}

/**
 * Deterministic in-memory EventBus for fast unit/integration tests without Inngest.
 */
export class InMemoryEventBus implements EventBus {
  readonly events: AppDomainEvent[] = [];

  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    const list = Array.isArray(event) ? event : [event];
    this.events.push(...list);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export const defaultEventBus: EventBus = new InngestEventBus();
