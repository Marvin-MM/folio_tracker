import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import {
  getLocalDateKey,
  getLocalTimeHHmm,
  isHabitScheduledOnDate,
  isValidTimeHHmm,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  INNGEST_CONCURRENCY_LIMIT,
  INNGEST_CRON_CONCURRENCY,
  inngest,
} from "@/server/inngest/client";
import { habitNudgeEvent } from "@/server/inngest/events";
import { EmailNotificationChannel } from "@/server/providers/channels/email-notification-channel";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { WebPushNotificationChannel } from "@/server/providers/channels/web-push-notification-channel";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";

const NUDGE_BATCH_SIZE = 200;
const MAX_BATCHES_PER_INVOCATION = 50;

const defaultInAppChannel = new InAppNotificationChannel();
const defaultWebPushChannel = new WebPushNotificationChannel();
const defaultEmailChannel = new EmailNotificationChannel();

export interface HabitNudgePayload {
  userId: string;
  dateKey: string;
  slot: string;
  kind: "habit_preferred" | "evening_checkin";
  habitId: string | null;
  dedupKey: string;
  timezone: string;
}

export interface HabitNudgeDeliveryDeps {
  habits?: HabitRepository;
  notifications?: NotificationRepository;
  inAppChannel?: NotificationChannel;
  webPushChannel?: NotificationChannel;
  emailChannel?: NotificationChannel;
  runStep?: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
}

export type HabitNudgeDeliveryOutcome =
  | { status: "skipped_duplicate"; dedupKey: string }
  | { status: "skipped_already_logged_or_inactive"; dedupKey: string }
  | {
      status: "delivered";
      dedupKey: string;
      channels: NotificationDispatchResult[];
    };

function toMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Matches a configured local target time (`HH:mm`) against the current 15-minute
 * cron bucket (`[windowStart, windowStart + 14]`) so each scheduled time fires
 * exactly once per day in the user's IANA timezone.
 */
export function isTimeInCurrent15MinWindow(
  targetHHmm: string,
  currentHHmm: string
): boolean {
  if (!isValidTimeHHmm(targetHHmm) || !isValidTimeHHmm(currentHHmm)) {
    return false;
  }
  const targetMins = toMinutesOfDay(targetHHmm);
  const currentMins = toMinutesOfDay(currentHHmm);
  const windowStart = Math.floor(currentMins / 15) * 15;
  return targetMins >= windowStart && targetMins < windowStart + 15;
}

/**
 * Dispatches one bounded page (`LIMIT 200`) of due habit nudges using
 * deterministic Inngest event IDs (`habit-nudge-${userId}-${dateKey}-${slot}`).
 */
export async function dispatchHabitNudgeBatch(
  params: {
    limit?: number;
    offset?: number;
    nowMs?: number;
  } = {},
  deps: {
    habits?: HabitRepository;
    eventBus?: EventBus;
  } = {}
): Promise<{ candidatesChecked: number; eventsEmitted: number }> {
  const limit = params.limit ?? NUDGE_BATCH_SIZE;
  const offset = params.offset ?? 0;
  const nowMs = params.nowMs ?? Date.now();
  const habitRepo = deps.habits ?? habitRepository;
  const eventBus = deps.eventBus ?? defaultEventBus;

  const candidates = await habitRepo.listNudgeUserCandidatesPage(limit, offset);
  if (candidates.length === 0) {
    return { candidatesChecked: 0, eventsEmitted: 0 };
  }

  const events: AppDomainEvent[] = [];

  for (const candidate of candidates) {
    const dateKey = getLocalDateKey(nowMs, candidate.timezone);
    const currentHHmm = getLocalTimeHHmm(nowMs, candidate.timezone);

    const [activeHabits, todayLogs] = await Promise.all([
      habitRepo.listHabitsForUser(candidate.userId, { includeArchived: false }),
      habitRepo.listLogsForRange(candidate.userId, dateKey, dateKey),
    ]);

    if (activeHabits.length === 0) continue;

    const loggedHabitIds = new Set(todayLogs.map((l) => l.habitId));
    const unloggedScheduled = activeHabits.filter((habit) => {
      if (loggedHabitIds.has(habit.id)) return false;
      return isHabitScheduledOnDate(
        {
          cadenceType: habit.cadenceType,
          scheduledDays: parseScheduledDaysJson(habit.scheduledDaysJson),
          startDate: habit.startDate,
        },
        dateKey
      );
    });

    if (unloggedScheduled.length === 0) continue;

    for (const habit of unloggedScheduled) {
      if (
        habit.preferredTime &&
        isTimeInCurrent15MinWindow(habit.preferredTime, currentHHmm)
      ) {
        const slot = `pref-${habit.id}-${habit.preferredTime.replace(":", "")}`;
        const dedupKey = `habit-nudge-${candidate.userId}-${dateKey}-${slot}`;
        events.push({
          id: dedupKey,
          name: "app/habit.nudge",
          data: {
            userId: candidate.userId,
            dateKey,
            slot,
            kind: "habit_preferred",
            habitId: habit.id,
            dedupKey,
            timezone: candidate.timezone,
          },
        });
      }
    }

    if (
      candidate.eveningCheckinTime &&
      isTimeInCurrent15MinWindow(candidate.eveningCheckinTime, currentHHmm)
    ) {
      const slot = `evening-${candidate.eveningCheckinTime.replace(":", "")}`;
      const dedupKey = `habit-nudge-${candidate.userId}-${dateKey}-${slot}`;
      events.push({
        id: dedupKey,
        name: "app/habit.nudge",
        data: {
          userId: candidate.userId,
          dateKey,
          slot,
          kind: "evening_checkin",
          habitId: null,
          dedupKey,
          timezone: candidate.timezone,
        },
      });
    }
  }

  if (events.length > 0) {
    await eventBus.emit(events);
  }

  return {
    candidatesChecked: candidates.length,
    eventsEmitted: events.length,
  };
}

/**
 * Pure, testable habit nudge delivery orchestrator shared by
 * `deliverHabitNudgeFn` and Vitest integration tests.
 *
 * Enforces:
 * 1. DB-backed deduplication via `(userId, type = 'habit.nudge', entityId = dedupKey)`.
 * 2. Live re-verification that the target habit(s) are still active & unlogged today.
 * 3. Delivery through InApp, WebPush, and Email channels deep-linking to `/app/habits`.
 */
export async function executeHabitNudgeDelivery(
  input: HabitNudgePayload,
  deps: HabitNudgeDeliveryDeps = {}
): Promise<HabitNudgeDeliveryOutcome> {
  const habitRepo = deps.habits ?? habitRepository;
  const notifRepo = deps.notifications ?? notificationRepository;
  const inApp = deps.inAppChannel ?? defaultInAppChannel;
  const webPush = deps.webPushChannel ?? defaultWebPushChannel;
  const email = deps.emailChannel ?? defaultEmailChannel;
  const runStep =
    deps.runStep ?? (async <T>(_id: string, fn: () => Promise<T>) => fn());

  const alreadySent = await runStep("check-nudge-dedup", async () =>
    notifRepo.hasNotificationForEntity(
      input.userId,
      "habit.nudge",
      input.dedupKey
    )
  );

  if (alreadySent) {
    return { status: "skipped_duplicate", dedupKey: input.dedupKey };
  }

  const message = await runStep("verify-unlogged-habits", async () => {
    if (input.kind === "habit_preferred" && input.habitId) {
      const habit = await habitRepo.getHabitForUser(
        input.userId,
        input.habitId
      );
      if (!habit || habit.isArchived) return null;

      const existingLog = await habitRepo.getLogForHabitDay(
        input.userId,
        habit.id,
        input.dateKey
      );
      if (existingLog) return null;

      return {
        title: `Habit nudge: ${habit.title}`,
        body: `Time for "${habit.title}" — check in on Folio to keep your momentum going.`,
      };
    }

    const [activeHabits, todayLogs] = await Promise.all([
      habitRepo.listHabitsForUser(input.userId, { includeArchived: false }),
      habitRepo.listLogsForRange(input.userId, input.dateKey, input.dateKey),
    ]);
    const loggedIds = new Set(todayLogs.map((l) => l.habitId));
    const remaining = activeHabits.filter((habit) => {
      if (loggedIds.has(habit.id)) return false;
      return isHabitScheduledOnDate(
        {
          cadenceType: habit.cadenceType,
          scheduledDays: parseScheduledDaysJson(habit.scheduledDaysJson),
          startDate: habit.startDate,
        },
        input.dateKey
      );
    });

    if (remaining.length === 0) return null;

    const preview = remaining
      .slice(0, 3)
      .map((h) => h.title)
      .join(", ");
    const suffix =
      remaining.length > 3 ? ` +${remaining.length - 3} more` : "";

    return {
      title: `Evening check-in · ${remaining.length} habit${remaining.length === 1 ? "" : "s"} left`,
      body: `Still open for ${input.dateKey}: ${preview}${suffix}.`,
    };
  });

  if (!message) {
    return {
      status: "skipped_already_logged_or_inactive",
      dedupKey: input.dedupKey,
    };
  }

  const payload: NotificationPayload = {
    userId: input.userId,
    type: "habit.nudge",
    title: message.title,
    body: message.body,
    entityType: "habit_nudge",
    entityId: input.dedupKey,
    deepLink: "/app/habits",
    timezone: input.timezone,
  };

  const inAppResult = await runStep("dispatch-habit-in-app", () =>
    inApp.send(payload)
  );
  const webPushResult = await runStep("dispatch-habit-web-push", () =>
    webPush.send(payload)
  );
  const emailResult = await runStep("dispatch-habit-email", () =>
    email.send(payload)
  );

  return {
    status: "delivered",
    dedupKey: input.dedupKey,
    channels: [inAppResult, webPushResult, emailResult],
  };
}

/**
 * 15-minute paginated Inngest cron scanning active habit-nudge users in
 * bounded `LIMIT 200` chunks inside isolated `step.run()` calls.
 */
export const habitNudgeDispatcherFn = inngest.createFunction(
  {
    id: "habit-nudge-dispatcher",
    concurrency: { limit: INNGEST_CRON_CONCURRENCY },
    retries: 4,
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const nowMs = Date.now();
    let totalCandidates = 0;
    let totalEmitted = 0;
    let batchNumber = 0;

    while (batchNumber < MAX_BATCHES_PER_INVOCATION) {
      const offset = batchNumber * NUDGE_BATCH_SIZE;
      batchNumber += 1;

      const batchResult = await step.run(`batch-${batchNumber}`, async () =>
        dispatchHabitNudgeBatch({
          limit: NUDGE_BATCH_SIZE,
          offset,
          nowMs,
        })
      );

      totalCandidates += batchResult.candidatesChecked;
      totalEmitted += batchResult.eventsEmitted;

      if (batchResult.candidatesChecked < NUDGE_BATCH_SIZE) {
        break;
      }
    }

    return {
      batches: batchNumber,
      candidatesChecked: totalCandidates,
      eventsEmitted: totalEmitted,
    };
  }
);

export const deliverHabitNudgeFn = inngest.createFunction(
  {
    id: "deliver-habit-nudge",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitNudgeEvent],
  },
  async ({ event, step }) => {
    return executeHabitNudgeDelivery(event.data, {
      runStep: async <T>(stepId: string, fn: () => Promise<T>): Promise<T> =>
        (await step.run(stepId, fn)) as T,
    });
  }
);
