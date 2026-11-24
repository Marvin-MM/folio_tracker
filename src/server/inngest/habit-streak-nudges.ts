import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitGroupRepository,
  type HabitGroupRepository,
} from "@/server/dal/habit-groups";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import {
  computeHabitStreaks,
  getLocalDateKey,
  getLocalTimeHHmm,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  evaluateStreakRisk,
  formatStreakPhrase,
  isWithinQuietHours,
} from "@/server/domain/habit-group-policy";
import {
  INNGEST_CONCURRENCY_LIMIT,
  INNGEST_CRON_CONCURRENCY,
  inngest,
} from "@/server/inngest/client";
import { habitStreakRiskEvent } from "@/server/inngest/events";
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

const NUDGE_BATCH_SIZE = 100;
const MAX_BATCHES_PER_INVOCATION = 50;
const STREAK_LOOKBACK_DAYS = 400;

const defaultInAppChannel = new InAppNotificationChannel();
const defaultWebPushChannel = new WebPushNotificationChannel();

export interface StreakNudgePayload {
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
}

export type StreakNudgeDeliveryOutcome =
  | { status: "skipped_duplicate"; dedupKey: string }
  | { status: "skipped_no_longer_active"; dedupKey: string }
  | { status: "skipped_already_logged"; dedupKey: string }
  | {
      status: "delivered";
      dedupKey: string;
      channels: NotificationDispatchResult[];
    };

interface BatchDeps {
  groups?: HabitGroupRepository;
  habits?: HabitRepository;
  eventBus?: EventBus;
  now?: () => number;
}

interface DeliveryDeps {
  groups?: HabitGroupRepository;
  habits?: HabitRepository;
  notifications?: NotificationRepository;
  inAppChannel?: NotificationChannel;
  webPushChannel?: NotificationChannel;
  now?: () => number;
  runStep?: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
}

function localHourFromHHmm(hhmm: string): number {
  const [hour] = hhmm.split(":").map(Number);
  return hour ?? 0;
}

/**
 * Hourly, paginated scan of active group members. Emits one deterministic
 * event per (group, member, recipient, local day) only when an established
 * streak is genuinely at risk. Recipient quiet hours are respected here so
 * the next hourly pass can deliver later instead of losing the nudge.
 */
export async function dispatchHabitStreakRiskBatch(
  params: { limit?: number; offset?: number; nowMs?: number } = {},
  deps: BatchDeps = {}
): Promise<{ candidatesChecked: number; eventsEmitted: number }> {
  const limit = params.limit ?? NUDGE_BATCH_SIZE;
  const offset = params.offset ?? 0;
  const nowMs = params.nowMs ?? Date.now();
  const groups = deps.groups ?? habitGroupRepository;
  const habitRepo = deps.habits ?? habitRepository;
  const eventBus = deps.eventBus ?? defaultEventBus;

  const candidates = await groups.listActiveMemberCandidatesPage(limit, offset);
  if (candidates.length === 0) {
    return { candidatesChecked: 0, eventsEmitted: 0 };
  }

  const events: AppDomainEvent[] = [];

  // Fetch logs once per owner for the whole batch, covering the union of date
  // ranges needed by that owner's candidates. The result intentionally spans
  // all of the owner's habits; per-habit filtering below is the boundary that
  // keeps private, unshared habits out of streak calculations and notifications.
  const ownerFetchRange = new Map<string, { start: string; end: string }>();
  const scheduledSharedByCandidate = new Map<
    number,
    Awaited<ReturnType<HabitGroupRepository["listActiveMemberCandidatesPage"]>>[number]["sharedHabits"]
  >();

  candidates.forEach((candidate, index) => {
    const dateKey = getLocalDateKey(nowMs, candidate.memberTimezone);
    const lookback = new Date(`${dateKey}T00:00:00.000Z`);
    lookback.setUTCDate(lookback.getUTCDate() - STREAK_LOOKBACK_DAYS);
    const lookbackKey = lookback.toISOString().slice(0, 10);
    const scheduled = candidate.sharedHabits.filter(
      (shared) =>
        shared.ownerId === candidate.memberUserId &&
        isHabitScheduledOnDate(
          {
            cadenceType: shared.cadenceType,
            scheduledDays: parseScheduledDaysJson(shared.scheduledDaysJson),
            startDate: shared.startDate,
          },
          dateKey
        )
    );
    scheduledSharedByCandidate.set(index, scheduled);

    for (const shared of scheduled) {
      const start =
        shared.startDate < lookbackKey ? lookbackKey : shared.startDate;
      const existing = ownerFetchRange.get(candidate.memberUserId);
      if (!existing) {
        ownerFetchRange.set(candidate.memberUserId, {
          start,
          end: dateKey,
        });
        continue;
      }
      if (start < existing.start) existing.start = start;
      if (dateKey > existing.end) existing.end = dateKey;
    }
  });

  const logsByOwner = new Map<
    string,
    Awaited<ReturnType<HabitRepository["listLogsForRange"]>>
  >();
  await Promise.all(
    Array.from(ownerFetchRange.entries()).map(async ([ownerId, range]) => {
      logsByOwner.set(
        ownerId,
        await habitRepo.listLogsForRange(ownerId, range.start, range.end)
      );
    })
  );

  for (const [index, candidate] of candidates.entries()) {
    if (!candidate.memberSettings.partnerNudgesEnabled) continue;
    if (candidate.recipients.length === 0) continue;

    const dateKey = getLocalDateKey(nowMs, candidate.memberTimezone);
    const localHHmm = getLocalTimeHHmm(nowMs, candidate.memberTimezone);
    const localHour = localHourFromHHmm(localHHmm);

    let atRisk:
      | {
          habitId: string;
          habitTitle: string;
          currentStreak: number;
          streakUnit: "days" | "weeks";
          reason: "unlogged" | "missed";
        }
      | null = null;

    for (const shared of scheduledSharedByCandidate.get(index) ?? []) {
      const logs = (logsByOwner.get(candidate.memberUserId) ?? []).filter(
        (log) => log.habitId === shared.habitId
      );
      const logMap = new Map(logs.map((log) => [log.dateKey, log.status]));
      const streaks = computeHabitStreaks(
        {
          id: shared.habitId,
          title: shared.title,
          cadenceType: shared.cadenceType,
          scheduledDays: parseScheduledDaysJson(shared.scheduledDaysJson),
          weeklyTargetCount: shared.weeklyTargetCount,
          startDate: shared.startDate,
        },
        logMap as Parameters<typeof computeHabitStreaks>[1],
        dateKey,
        candidate.memberSettings.weekStartsOn === 0 ? 0 : 1
      );
      const risk = evaluateStreakRisk({
        currentStreak: streaks.currentStreak,
        minStreak: candidate.memberSettings.partnerNudgeMinStreak,
        scheduledToday: true,
        todayStatus: logMap.get(dateKey) ?? null,
        localHour,
        startHour: candidate.memberSettings.partnerNudgeStartHour,
      });
      if (!risk.atRisk || !risk.reason) continue;
      if (!atRisk || streaks.currentStreak > atRisk.currentStreak) {
        atRisk = {
          habitId: shared.habitId,
          habitTitle: shared.title,
          currentStreak: streaks.currentStreak,
          streakUnit: streaks.streakUnit,
          reason: risk.reason,
        };
      }
    }

    if (!atRisk) continue;

    for (const recipient of candidate.recipients) {
      if (!recipient.settings.partnerNudgesEnabled) continue;
      const recipientHHmm = getLocalTimeHHmm(nowMs, recipient.timezone);
      if (
        isWithinQuietHours(
          recipientHHmm,
          recipient.settings.nudgeQuietHoursStart,
          recipient.settings.nudgeQuietHoursEnd
        )
      ) {
        continue;
      }

      const dedupKey = `habit-streak-risk:${candidate.groupId}:${candidate.memberUserId}:${recipient.userId}:${dateKey}`;
      const payload: StreakNudgePayload = {
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        ownerId: candidate.memberUserId,
        ownerName: candidate.memberName,
        ownerTimezone: candidate.memberTimezone,
        recipientId: recipient.userId,
        recipientName: recipient.name,
        recipientTimezone: recipient.timezone,
        habitId: atRisk.habitId,
        habitTitle: atRisk.habitTitle,
        dateKey,
        currentStreak: atRisk.currentStreak,
        streakUnit: atRisk.streakUnit,
        reason: atRisk.reason,
        dedupKey,
      };
      events.push({
        id: dedupKey,
        name: "app/habit.streak_at_risk",
        data: payload,
      });
    }
  }

  if (events.length > 0) await eventBus.emit(events);

  return { candidatesChecked: candidates.length, eventsEmitted: events.length };
}

/**
 * Re-verifies memberships, habit sharing, both opt-ins, the streak status and
 * quiet hours before delivery, then uses deterministic notification IDs to
 * avoid repeat pings.
 */
export async function executeHabitStreakRiskDelivery(
  input: StreakNudgePayload,
  deps: DeliveryDeps = {}
): Promise<StreakNudgeDeliveryOutcome> {
  const groups = deps.groups ?? habitGroupRepository;
  const habitRepo = deps.habits ?? habitRepository;
  const notifications = deps.notifications ?? notificationRepository;
  const inApp = deps.inAppChannel ?? defaultInAppChannel;
  const webPush = deps.webPushChannel ?? defaultWebPushChannel;
  const nowMs = (deps.now ?? (() => Date.now()))();
  const runStep =
    deps.runStep ?? (async <T>(_id: string, fn: () => Promise<T>) => fn());

  const alreadySent = await runStep("check-streak-nudge-dedup", () =>
    notifications.hasNotificationForEntity(
      input.recipientId,
      "habit.streak_risk",
      input.dedupKey
    )
  );
  if (alreadySent) {
    return { status: "skipped_duplicate", dedupKey: input.dedupKey };
  }

  const context = await runStep("verify-group-and-streak", async () => {
    const [owner, recipient] = await Promise.all([
      groups.getMember(input.groupId, input.ownerId),
      groups.getMember(input.groupId, input.recipientId),
    ]);
    if (
      !owner ||
      !recipient ||
      owner.status !== "active" ||
      recipient.status !== "active"
    ) {
      return null;
    }

    // The queued event may be minutes old: unsharing, leaving the group, or
    // either partner opting out since the scan must cancel the delivery.
    const stillShared = await groups.isHabitSharedWithGroup(
      input.groupId,
      input.habitId
    );
    if (!stillShared) return null;

    const [ownerSettings, recipientSettings, todayLogs] = await Promise.all([
      habitRepo.getOrCreateSettings(input.ownerId),
      habitRepo.getOrCreateSettings(input.recipientId),
      habitRepo.listLogsForRange(input.ownerId, input.dateKey, input.dateKey),
    ]);
    if (
      !ownerSettings.partnerNudgesEnabled ||
      !recipientSettings.partnerNudgesEnabled
    ) {
      return null;
    }

    const status = todayLogs.find((log) => log.habitId === input.habitId)?.status;
    if (status === "done" || status === "skipped") return "logged" as const;

    const recipientHHmm = getLocalTimeHHmm(nowMs, input.recipientTimezone);
    if (
      isWithinQuietHours(
        recipientHHmm,
        recipientSettings.nudgeQuietHoursStart,
        recipientSettings.nudgeQuietHoursEnd
      )
    ) {
      return null;
    }
    return { recipientTimezone: input.recipientTimezone };
  });

  if (context === null) {
    return { status: "skipped_no_longer_active", dedupKey: input.dedupKey };
  }
  if (context === "logged") {
    return { status: "skipped_already_logged", dedupKey: input.dedupKey };
  }

  const streak = formatStreakPhrase(input.currentStreak, input.streakUnit);
  const body =
    input.reason === "missed"
      ? `${input.ownerName} just missed "${input.habitTitle}" and their ${streak} streak is gone. Send some encouragement.`
      : `${input.ownerName}'s ${streak} streak on "${input.habitTitle}" ends today. A quick nudge could save it.`;

  const payload: NotificationPayload = {
    userId: input.recipientId,
    type: "habit.streak_risk",
    title: `${input.ownerName} needs a streak save`,
    body,
    entityType: "habit_streak_risk",
    // Both channels use the same deterministic id. It embeds the groupId, so
    // the bell can derive the deep link without relying on channel-specific
    // formatting, and dedup lookups match the persisted in-app notification.
    entityId: input.dedupKey,
    deepLink: `/app/habits/groups/${input.groupId}`,
    timezone: context.recipientTimezone,
  };

  const inAppResult = await runStep("dispatch-streak-nudge-in-app", () =>
    inApp.send(payload)
  );
  const webPushResult = await runStep("dispatch-streak-nudge-web-push", () =>
    webPush.send(payload)
  );

  return {
    status: "delivered",
    dedupKey: input.dedupKey,
    channels: [inAppResult, webPushResult],
  };
}

export const habitStreakRiskCronFn = inngest.createFunction(
  {
    id: "habit-streak-risk-cron",
    concurrency: { limit: INNGEST_CRON_CONCURRENCY },
    retries: 4,
    triggers: [{ cron: "10 * * * *" }],
  },
  async ({ step }) => {
    const nowMs = Date.now();
    let totalChecked = 0;
    let totalEmitted = 0;
    let batchNumber = 0;

    while (batchNumber < MAX_BATCHES_PER_INVOCATION) {
      const offset = batchNumber * NUDGE_BATCH_SIZE;
      batchNumber += 1;
      const result = await step.run(`streak-risk-batch-${batchNumber}`, () =>
        dispatchHabitStreakRiskBatch({
          limit: NUDGE_BATCH_SIZE,
          offset,
          nowMs,
        })
      );
      totalChecked += result.candidatesChecked;
      totalEmitted += result.eventsEmitted;
      if (result.candidatesChecked < NUDGE_BATCH_SIZE) break;
    }

    return {
      batches: batchNumber,
      candidatesChecked: totalChecked,
      eventsEmitted: totalEmitted,
    };
  }
);

export const deliverHabitStreakRiskFn = inngest.createFunction(
  {
    id: "deliver-habit-streak-risk",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitStreakRiskEvent],
  },
  async ({ event, step }) => {
    return executeHabitStreakRiskDelivery(event.data, {
      runStep: async <T>(stepId: string, fn: () => Promise<T>): Promise<T> =>
        (await step.run(stepId, fn)) as T,
    });
  }
);
