import { inngest } from "@/server/inngest/client";

export type AppDomainEvent =
  | {
      name: "app/reminder.scheduled";
      data: {
        reminderId: string;
        userId: string;
        entityType: "task" | "note";
        entityId: string;
        remindAt: number;
        version: number;
      };
    }
  | {
      name: "app/reminder.rescheduled";
      data: {
        reminderId: string;
        userId: string;
        version: number;
      };
    }
  | {
      name: "app/reminder.cancelled";
      data: {
        reminderId: string;
        userId: string;
        version: number;
      };
    }
  | {
      name: "app/auth.email";
      data: {
        kind: "verification" | "password_reset";
        to: string;
        recipientName: string;
        actionUrl: string;
      };
    }
  | {
      name: "app/reminder.test";
      data: {
        userId: string;
        timezone: string;
      };
    }
  | {
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
    };

export interface EventBus {
  emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void>;
}

/**
 * Production EventBus backed by Inngest v4.
 * Resilient in local dev (`INNGEST_DEV=1`): committed database writes are never
 * aborted if the local Inngest Dev Server is offline.
 */
export class InngestEventBus implements EventBus {
  async emit(event: AppDomainEvent | AppDomainEvent[]): Promise<void> {
    const events = Array.isArray(event) ? event : [event];
    if (events.length === 0) return;

    try {
      await inngest.send(events);
    } catch (error) {
      const isLocalDev =
        process.env.INNGEST_DEV === "1" ||
        process.env.NODE_ENV !== "production";
      if (isLocalDev) {
        console.warn(
          JSON.stringify({
            event: "event_bus.inngest.dev_unreachable",
            names: events.map((e) => e.name),
            reason: error instanceof Error ? error.message : "Unknown error",
          })
        );
        return;
      }
      throw error;
    }
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
