import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitSocialRepository,
  type HabitSocialRepository,
} from "@/server/dal/habits-social";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import {
  didWindowOpenWithinLookback,
  evaluateCommentWindow,
  resolveEffectivePolicy,
} from "@/server/domain/comment-window-policy";
import {
  addDaysToDateKey,
  getLocalDateKey,
  isHabitScheduledOnDate,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  INNGEST_CONCURRENCY_LIMIT,
  INNGEST_CRON_CONCURRENCY,
  inngest,
} from "@/server/inngest/client";
import {
  habitCommentPostedEvent,
  habitMonitorInvitedEvent,
  habitMonitorRequestedEvent,
  habitReviewDigestEvent,
} from "@/server/inngest/events";
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

const DIGEST_BATCH_SIZE = 200;
const MAX_BATCHES_PER_INVOCATION = 50;

const defaultInAppChannel = new InAppNotificationChannel();
const defaultWebPushChannel = new WebPushNotificationChannel();
const defaultEmailChannel = new EmailNotificationChannel();

export interface SnapshotHabitMetric {
  doneCount: number;
  scheduledCount: number;
  completionRate: number | null;
}

export interface WeeklySnapshotMetricsPayload {
  version: 1;
  habits: Record<string, SnapshotHabitMetric>;
}

export interface HabitReviewDigestPayload {
  monitorId: string;
  ownerId: string;
  monitorUserId: string;
  cycleKey: string;
  periodStartDate: string;
  periodEndDate: string;
  dedupKey: string;
}

export interface HabitReviewDigestDeps {
  social?: HabitSocialRepository;
  habits?: HabitRepository;
  notifications?: NotificationRepository;
  inAppChannel?: NotificationChannel;
  webPushChannel?: NotificationChannel;
  emailChannel?: NotificationChannel;
  now?: () => number;
  runStep?: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
}

export type HabitReviewDigestOutcome =
  | { status: "skipped_duplicate"; dedupKey: string }
  | { status: "skipped_revoked_or_missing"; dedupKey: string }
  | {
      status: "delivered";
      dedupKey: string;
      scopedPct: number | null;
      channels: NotificationDispatchResult[];
    };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function renderHabitMonitorInviteHtml(params: {
  ownerName: string;
  scope: "all" | "selected";
  inviteUrl: string;
}): string {
  const scopeCopy =
    params.scope === "all"
      ? "their habit tracker"
      : "selected habits from their tracker";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background-color:#F9F8F6;color:#171614;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E6E4DF;border-radius:6px;">
      <tr>
        <td style="padding:24px 28px 10px 28px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#3B5B8A;">
          ${escapeHtml(APP_NAME)} · Accountability Circle
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:18px;font-weight:600;line-height:1.35;color:#171614;">
          Monitor ${escapeHtml(params.ownerName)}&rsquo;s habits
        </td>
      </tr>
      <tr>
        <td style="padding:4px 28px 20px 28px;font-size:14px;line-height:1.6;color:#171614;">
          <p style="margin:0;">${escapeHtml(params.ownerName)} invited you to join their Accountability Circle on ${escapeHtml(APP_NAME)} to follow ${escapeHtml(scopeCopy)} and share periodic review feedback.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;">
          <a href="${escapeHtml(params.inviteUrl)}" style="display:inline-block;padding:10px 18px;background:#171614;color:#F9F8F6;text-decoration:none;border-radius:5px;font-size:13px;font-weight:500;">
            Review &amp; Accept Invitation
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 20px 28px;border-top:1px solid #E6E4DF;font-size:11px;color:#6E6B64;">
          This single-use accountability invitation expires in 7 days. If you weren&rsquo;t expecting it, you can ignore this email.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildPeriodSnapshotMetrics(
  ownerHabits: Awaited<ReturnType<HabitRepository["listHabitsForUser"]>>,
  periodLogs: Awaited<ReturnType<HabitRepository["listLogsForRange"]>>,
  periodStartDate: string,
  periodEndDate: string
): WeeklySnapshotMetricsPayload {
  const logsByHabit = new Map<string, Map<string, string>>();
  for (const log of periodLogs) {
    let map = logsByHabit.get(log.habitId);
    if (!map) {
      map = new Map<string, string>();
      logsByHabit.set(log.habitId, map);
    }
    map.set(log.dateKey, log.status);
  }

  const metrics: Record<string, SnapshotHabitMetric> = {};

  for (const habit of ownerHabits) {
    const scheduledDays = parseScheduledDaysJson(habit.scheduledDaysJson);
    const habitLogsMap = logsByHabit.get(habit.id) ?? new Map<string, string>();

    let doneCount = 0;
    let scheduledCount = 0;
    let activeNonSkippedDays = 0;
    let cursor = periodStartDate;
    let guard = 0;

    while (cursor <= periodEndDate && guard < 60) {
      guard += 1;
      if (
        isHabitScheduledOnDate(
          {
            cadenceType: habit.cadenceType,
            scheduledDays,
            startDate: habit.startDate,
          },
          cursor
        )
      ) {
        const st = habitLogsMap.get(cursor);
        if (st !== "skipped") {
          activeNonSkippedDays += 1;
          if (st === "done") doneCount += 1;
        }
      }
      cursor = addDaysToDateKey(cursor, 1);
    }

    if (habit.cadenceType === "weekly_target") {
      const target = Math.max(1, Math.min(7, habit.weeklyTargetCount ?? 3));
      scheduledCount = Math.min(target, activeNonSkippedDays);
      doneCount = Math.min(doneCount, scheduledCount);
    } else {
      scheduledCount = activeNonSkippedDays;
    }

    metrics[habit.id] = {
      doneCount,
      scheduledCount,
      completionRate:
        scheduledCount > 0 ? Math.min(doneCount / scheduledCount, 1) : null,
    };
  }

  return { version: 1, habits: metrics };
}

function computeScopedPctFromSnapshot(
  metricsJson: string,
  allowedHabitIds: string[] | null
): number | null {
  try {
    const parsed = JSON.parse(metricsJson) as WeeklySnapshotMetricsPayload;
    if (!parsed || typeof parsed.habits !== "object") return null;

    const allowedSet =
      allowedHabitIds === null ? null : new Set(allowedHabitIds);
    let done = 0;
    let scheduled = 0;

    for (const [habitId, stats] of Object.entries(parsed.habits)) {
      if (allowedSet !== null && !allowedSet.has(habitId)) continue;
      done += stats.doneCount;
      scheduled += stats.scheduledCount;
    }

    if (scheduled === 0) return null;
    return Math.round(Math.min(done / scheduled, 1) * 100);
  } catch {
    return null;
  }
}

/**
 * Paginated hourly cron batch processor (`LIMIT 200`):
 * checks active `(owner, monitor)` pairs whose effective comment window opened
 * within the past 65 minutes and emits deterministic `app/habit.review_digest` events.
 */
export async function dispatchHabitReviewDigestBatch(
  params: {
    limit?: number;
    offset?: number;
    afterId?: string | null;
    nowMs?: number;
    lookbackMs?: number;
  } = {},
  deps: {
    social?: HabitSocialRepository;
    eventBus?: EventBus;
  } = {}
): Promise<{
  pairsChecked: number;
  eventsEmitted: number;
  lastId: string | null;
}> {
  const limit = params.limit ?? DIGEST_BATCH_SIZE;
  const offset = params.offset ?? 0;
  const nowMs = params.nowMs ?? Date.now();
  const lookbackMs = params.lookbackMs ?? 65 * 60 * 1000;
  const social = deps.social ?? habitSocialRepository;
  const eventBus = deps.eventBus ?? defaultEventBus;

  const pairs = await social.listActiveMonitorPairsPage(
    limit,
    offset,
    params.afterId ?? null
  );
  if (pairs.length === 0) {
    return { pairsChecked: 0, eventsEmitted: 0, lastId: null };
  }

  const events: AppDomainEvent[] = [];

  for (const pair of pairs) {
    const effectivePolicy = resolveEffectivePolicy(
      pair.globalSettings,
      pair.monitor
    );
    const windowState = evaluateCommentWindow(
      effectivePolicy,
      pair.ownerTimezone,
      nowMs
    );

    if (!didWindowOpenWithinLookback(windowState, nowMs, lookbackMs)) {
      continue;
    }

    const dedupKey = `habit-review-open-${pair.monitor.id}-${windowState.cycleKey}`;
    events.push({
      id: dedupKey,
      name: "app/habit.review_digest",
      data: {
        monitorId: pair.monitor.id,
        ownerId: pair.monitor.ownerId,
        monitorUserId: pair.monitor.monitorUserId,
        cycleKey: windowState.cycleKey,
        periodStartDate: windowState.periodStartDate,
        periodEndDate: windowState.periodEndDate,
        dedupKey,
      },
    });
  }

  if (events.length > 0) {
    await eventBus.emit(events);
  }

  return {
    pairsChecked: pairs.length,
    eventsEmitted: events.length,
    lastId: pairs[pairs.length - 1]?.monitor.id ?? null,
  };
}

/**
 * Pure, testable habit review digest delivery orchestrator.
 * - Re-verifies monitor relationship is still `'active'` directly in Turso.
 * - Deduplicates via `(monitorUserId, 'habit.review_open', dedupKey)`.
 * - Generates/reuses owner's per-habit `habitWeeklySnapshots` record and computes
 *   the summary % STRICTLY over the monitor's allowed habits (zero leak!).
 */
export async function executeHabitReviewDigestDelivery(
  input: HabitReviewDigestPayload,
  deps: HabitReviewDigestDeps = {}
): Promise<HabitReviewDigestOutcome> {
  const social = deps.social ?? habitSocialRepository;
  const habitRepo = deps.habits ?? habitRepository;
  const notifRepo = deps.notifications ?? notificationRepository;
  const inApp = deps.inAppChannel ?? defaultInAppChannel;
  const webPush = deps.webPushChannel ?? defaultWebPushChannel;
  const email = deps.emailChannel ?? defaultEmailChannel;
  const nowMs = (deps.now ?? (() => Date.now()))();
  const runStep =
    deps.runStep ?? (async <T>(_id: string, fn: () => Promise<T>) => fn());

  const alreadySent = await runStep("check-digest-dedup", () =>
    notifRepo.hasNotificationForEntity(
      input.monitorUserId,
      "habit.review_open",
      input.dedupKey
    )
  );
  if (alreadySent) {
    return { status: "skipped_duplicate", dedupKey: input.dedupKey };
  }

  const context = await runStep("verify-monitor-and-snapshot", async () => {
    const monitor = await social.getActiveMonitor(
      input.ownerId,
      input.monitorUserId
    );
    if (!monitor || monitor.id !== input.monitorId) {
      return null;
    }

    const [owner, monitorUser, allowedHabitIds] = await Promise.all([
      social.findUserById(input.ownerId),
      social.findUserById(input.monitorUserId),
      monitor.scope === "selected"
        ? social.listAllowedHabitIdsForMonitor(monitor.id)
        : Promise.resolve(null),
    ]);
    if (!owner || !monitorUser || owner.isSuspended || monitorUser.isSuspended) {
      return null;
    }

    let snapshot = await social.getWeeklySnapshot(
      input.ownerId,
      input.cycleKey
    );
    if (!snapshot) {
      const ownerTodayKey = getLocalDateKey(nowMs, owner.timezone || "UTC");
      const effectiveEnd =
        input.periodEndDate < ownerTodayKey
          ? input.periodEndDate
          : ownerTodayKey;
      const [ownerHabits, periodLogs] = await Promise.all([
        habitRepo.listHabitsForUser(input.ownerId, { includeArchived: false }),
        habitRepo.listLogsForRange(
          input.ownerId,
          input.periodStartDate,
          effectiveEnd
        ),
      ]);
      const metricsPayload = buildPeriodSnapshotMetrics(
        ownerHabits,
        periodLogs,
        input.periodStartDate,
        effectiveEnd
      );
      snapshot = await social.getOrCreateWeeklySnapshot({
        ownerId: input.ownerId,
        cycleKey: input.cycleKey,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        metricsJson: JSON.stringify(metricsPayload),
        nowMs,
      });
    }

    const scopedPct = computeScopedPctFromSnapshot(
      snapshot.metricsJson,
      allowedHabitIds
    );

    return {
      ownerName: owner.name,
      monitorTimezone: monitorUser.timezone || "UTC",
      scopedPct,
    };
  });

  if (!context) {
    return { status: "skipped_revoked_or_missing", dedupKey: input.dedupKey };
  }

  const pctSegment =
    context.scopedPct !== null ? ` (${context.scopedPct}% this cycle)` : "";

  const payload: NotificationPayload = {
    userId: input.monitorUserId,
    type: "habit.review_open",
    title: `${context.ownerName}'s habit review window is open`,
    body: `${context.ownerName}'s habit review window is now open${pctSegment} — view progress and leave feedback.`,
    entityType: "habit_review",
    entityId: `${input.dedupKey}::${input.ownerId}`,
    deepLink: `/app/habits/circle/${input.ownerId}`,
    timezone: context.monitorTimezone,
  };

  // Note: `InAppNotificationChannel` saves `entityId` directly; store `dedupKey`
  // cleanly so `hasNotificationForEntity(monitorUserId, "habit.review_open", dedupKey)`
  // matches on retry!
  const inAppPayload: NotificationPayload = {
    ...payload,
    entityId: input.dedupKey,
  };

  const inAppResult = await runStep("dispatch-digest-in-app", () =>
    inApp.send(inAppPayload)
  );
  const webPushResult = await runStep("dispatch-digest-web-push", () =>
    webPush.send(payload)
  );
  const emailResult = await runStep("dispatch-digest-email", () =>
    email.send(payload)
  );

  return {
    status: "delivered",
    dedupKey: input.dedupKey,
    scopedPct: context.scopedPct,
    channels: [inAppResult, webPushResult, emailResult],
  };
}

export const habitReviewDigestCronFn = inngest.createFunction(
  {
    id: "habit-review-digest-cron",
    concurrency: { limit: INNGEST_CRON_CONCURRENCY },
    retries: 4,
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const nowMs = await step.run("capture-clock", () => Date.now());
    let totalChecked = 0;
    let totalEmitted = 0;
    let batchNumber = 0;
    let cursor: string | null = null;

    while (batchNumber < MAX_BATCHES_PER_INVOCATION) {
      const batchCursor: string | null = cursor;
      batchNumber += 1;

      const batchResult: {
        pairsChecked: number;
        eventsEmitted: number;
        lastId: string | null;
      } = await step.run(`batch-${batchNumber}`, () =>
        dispatchHabitReviewDigestBatch({
          limit: DIGEST_BATCH_SIZE,
          afterId: batchCursor,
          nowMs,
        })
      );

      totalChecked += batchResult.pairsChecked;
      totalEmitted += batchResult.eventsEmitted;
      cursor = batchResult.lastId;

      if (batchResult.pairsChecked < DIGEST_BATCH_SIZE || !cursor) {
        break;
      }
    }

    return {
      batches: batchNumber,
      pairsChecked: totalChecked,
      eventsEmitted: totalEmitted,
    };
  }
);

export const deliverHabitReviewDigestFn = inngest.createFunction(
  {
    id: "deliver-habit-review-digest",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitReviewDigestEvent],
  },
  async ({ event, step }) => {
    return executeHabitReviewDigestDelivery(event.data, {
      runStep: async <T>(stepId: string, fn: () => Promise<T>): Promise<T> =>
        (await step.run(stepId, fn)) as T,
    });
  }
);

export const sendHabitMonitorRequestFn = inngest.createFunction(
  {
    id: "send-habit-monitor-request",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitMonitorRequestedEvent],
  },
  async ({ event, step }) => {
    const { requestId, ownerName, targetUserId, scope } = event.data;
    const scopeText =
      scope === "all" ? "all their habits" : "selected habits";
    const payload: NotificationPayload = {
      userId: targetUserId,
      type: "habit.monitor_requested",
      title: `${ownerName} invited you to their Accountability Circle`,
      body: `Accept or decline to monitor ${scopeText} and share periodic check-in reviews.`,
      entityType: "habit_monitor_request",
      entityId: requestId,
      deepLink: "/app/habits/circle",
    };

    await step.run("dispatch-req-in-app", () => defaultInAppChannel.send(payload));
    await step.run("dispatch-req-push", () => defaultWebPushChannel.send(payload));
    await step.run("dispatch-req-email", () => defaultEmailChannel.send(payload));

    return { dispatched: true };
  }
);

export const sendHabitMonitorInviteFn = inngest.createFunction(
  {
    id: "send-habit-monitor-invite",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitMonitorInvitedEvent],
  },
  async ({ event, step }) => {
    const { ownerName, targetEmail, scope, inviteUrl } = event.data;

    await step.run("send-habit-invite-email", async () => {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) {
        console.info(
          JSON.stringify({
            event: "habit.monitor.invite.email.dispatched",
            transport: "dev-console",
            recipient: maskEmail(targetEmail),
            scope,
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      const from =
        process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: targetEmail,
        subject: `${ownerName} invited you to monitor their habits on ${APP_NAME}`,
        html: renderHabitMonitorInviteHtml({ ownerName, scope, inviteUrl }),
        text: `${ownerName} invited you to their Accountability Circle on ${APP_NAME}.\n\nReview & accept: ${inviteUrl}\n\nExpires in 7 days.`,
      });

      if (error) {
        throw new Error(`Resend habit invite email failed: ${error.message}`);
      }
    });

    return { dispatched: true };
  }
);

export const sendHabitCommentNotificationFn = inngest.createFunction(
  {
    id: "send-habit-comment-notification",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [habitCommentPostedEvent],
  },
  async ({ event, step }) => {
    const {
      commentId,
      ownerId,
      authorName,
      recipientUserId,
      bodyPreview,
      deepLink,
    } = event.data;

    // Live Turso re-verification: never deliver comment previews to a revoked monitor or suspended user
    const allowed = await step.run("verify-comment-recipient", async () => {
      const recipient = await habitSocialRepository.findUserById(recipientUserId);
      if (!recipient || recipient.isSuspended) return false;
      if (recipientUserId !== ownerId) {
        const activeMonitor = await habitSocialRepository.getActiveMonitor(
          ownerId,
          recipientUserId
        );
        if (!activeMonitor) return false;
      }
      return true;
    });

    if (!allowed) {
      return { dispatched: false, skipped: true };
    }

    const payload: NotificationPayload = {
      userId: recipientUserId,
      type: "habit.comment_posted",
      title: `New habit review from ${authorName}`,
      body: bodyPreview,
      entityType: "habit_comment",
      entityId: commentId,
      deepLink,
    };

    await step.run("dispatch-comment-in-app", () =>
      defaultInAppChannel.send(payload)
    );
    await step.run("dispatch-comment-push", () =>
      defaultWebPushChannel.send(payload)
    );
    return { dispatched: true };
  }
);
