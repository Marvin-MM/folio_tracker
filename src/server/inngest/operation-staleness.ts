import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import {
  operationRepository,
  type OperationRepository,
} from "@/server/dal/operations";
import {
  operationsSocialRepository,
  type OperationsSocialRepository,
} from "@/server/dal/operations-social";
import {
  INNGEST_CONCURRENCY_LIMIT,
  INNGEST_CRON_CONCURRENCY,
  inngest,
} from "@/server/inngest/client";
import {
  operationInvitedEmailEvent,
  operationInvitedInAppEvent,
  operationStaleAuditEvent,
  operationStepFlaggedEvent,
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

const STALE_AUDIT_BATCH_SIZE = 200;
const MAX_BATCHES_PER_INVOCATION = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const defaultInAppChannel = new InAppNotificationChannel();
const defaultWebPushChannel = new WebPushNotificationChannel();
const defaultEmailChannel = new EmailNotificationChannel();

export interface StaleOperationAuditPayload {
  operationId: string;
  ownerId: string;
  operationTitle: string;
  reviewCycleDays: number;
  daysSinceVerified: number;
  cycleBucket: number;
  dedupKey: string;
}

export type StaleOperationNudgeOutcome =
  | { status: "skipped_duplicate"; dedupKey: string }
  | { status: "skipped_verified_or_archived"; dedupKey: string }
  | {
      status: "delivered";
      dedupKey: string;
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
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

/**
 * Computes deterministic staleness cycle bucket so an owner receives at most
 * one staleness nudge per review-cycle period (`op-stale-${id}-${bucket}`).
 */
export function computeStaleCycleBucket(params: {
  anchorMs: number;
  reviewCycleDays: number;
  nowMs: number;
}): { daysSinceVerified: number; cycleBucket: number } {
  const cycleMs = Math.max(1, params.reviewCycleDays) * DAY_MS;
  const elapsedMs = Math.max(0, params.nowMs - params.anchorMs);
  const daysSinceVerified = Math.floor(elapsedMs / DAY_MS);
  const cycleBucket = Math.max(1, Math.floor(elapsedMs / cycleMs));
  return { daysSinceVerified, cycleBucket };
}

/**
 * Scans one bounded `LIMIT 200` page of stale operations and emits deterministic
 * `app/operation.stale_audit` events for worker delivery.
 */
export async function dispatchStaleOperationsBatch(
  params: {
    limit?: number;
    offset?: number;
    afterId?: string | null;
    nowMs?: number;
  } = {},
  deps: {
    social?: OperationsSocialRepository;
    eventBus?: EventBus;
  } = {}
): Promise<{
  candidatesChecked: number;
  eventsEmitted: number;
  lastId: string | null;
}> {
  const limit = params.limit ?? STALE_AUDIT_BATCH_SIZE;
  const offset = params.offset ?? 0;
  const nowMs = params.nowMs ?? Date.now();
  const socialRepo = deps.social ?? operationsSocialRepository;
  const eventBus = deps.eventBus ?? defaultEventBus;

  const candidates = await socialRepo.listStaleOperationCandidatesPage(
    limit,
    offset,
    nowMs,
    undefined,
    params.afterId ?? null
  );
  if (candidates.length === 0) {
    return { candidatesChecked: 0, eventsEmitted: 0, lastId: null };
  }

  const events: AppDomainEvent[] = candidates.map((op) => {
    const anchorMs = op.lastVerifiedAt ?? op.updatedAt;
    const { daysSinceVerified, cycleBucket } = computeStaleCycleBucket({
      anchorMs,
      reviewCycleDays: op.reviewCycleDays,
      nowMs,
    });
    const dedupKey = `op-stale-${op.id}-${cycleBucket}`;

    return {
      id: dedupKey,
      name: "app/operation.stale_audit" as const,
      data: {
        operationId: op.id,
        ownerId: op.ownerId,
        operationTitle: op.title,
        reviewCycleDays: op.reviewCycleDays,
        daysSinceVerified,
        cycleBucket,
        dedupKey,
      },
    };
  });

  if (events.length > 0) {
    await eventBus.emit(events);
  }

  return {
    candidatesChecked: candidates.length,
    eventsEmitted: events.length,
    lastId: candidates[candidates.length - 1]?.id ?? null,
  };
}

/**
 * Re-verifies staleness directly against Turso, enforces DB dedup, and delivers
 * a single crisp InApp + WebPush + Email review reminder per cycle.
 */
export async function deliverStaleOperationNudge(
  payload: StaleOperationAuditPayload,
  deps: {
    operations?: OperationRepository;
    notifications?: NotificationRepository;
    inAppChannel?: NotificationChannel;
    webPushChannel?: NotificationChannel;
    emailChannel?: NotificationChannel;
    now?: () => number;
    runStep?: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
  } = {}
): Promise<StaleOperationNudgeOutcome> {
  const opRepo = deps.operations ?? operationRepository;
  const notifRepo = deps.notifications ?? notificationRepository;
  const inAppChannel = deps.inAppChannel ?? defaultInAppChannel;
  const webPushChannel = deps.webPushChannel ?? defaultWebPushChannel;
  const emailChannel = deps.emailChannel ?? defaultEmailChannel;
  const now = deps.now ?? (() => Date.now());
  const runStep = deps.runStep ?? (async <T,>(_id: string, fn: () => Promise<T>) => fn());

  const alreadySent = await runStep("check-dedup", () =>
    notifRepo.hasNotificationForEntity(
      payload.ownerId,
      "operation_stale",
      payload.dedupKey
    )
  );
  if (alreadySent) {
    return { status: "skipped_duplicate", dedupKey: payload.dedupKey };
  }

  const stillStale = await runStep("reverify-staleness", async () => {
    const op = await opRepo.getById(payload.operationId);
    if (!op || op.isArchived || !op.reviewCycleDays || op.ownerId !== payload.ownerId) {
      return false;
    }
    const anchorMs = op.lastVerifiedAt ?? op.updatedAt;
    return anchorMs + op.reviewCycleDays * DAY_MS <= now();
  });

  if (!stillStale) {
    return { status: "skipped_verified_or_archived", dedupKey: payload.dedupKey };
  }

  const notifPayload: NotificationPayload = {
    userId: payload.ownerId,
    type: "operation_stale",
    title: `Review due: ${payload.operationTitle}`,
    body: `Your operation "${payload.operationTitle}" hasn't been verified in ${payload.daysSinceVerified} days — review steps or mark verified.`,
    entityType: "operation",
    entityId: payload.dedupKey,
    deepLink: `/app/operations/${payload.operationId}`,
  };

  const results: NotificationDispatchResult[] = [];

  const inAppResult = await runStep("deliver-in-app", () =>
    inAppChannel.send(notifPayload)
  );
  results.push(inAppResult);

  const pushResult = await runStep("deliver-web-push", () =>
    webPushChannel.send(notifPayload)
  );
  results.push(pushResult);

  if (!pushResult.delivered) {
    const emailResult = await runStep("deliver-email-fallback", () =>
      emailChannel.send(notifPayload)
    );
    results.push(emailResult);
  }

  return {
    status: "delivered",
    dedupKey: payload.dedupKey,
    channels: results,
  };
}

/**
 * Daily paginated cron checking non-archived operations whose review cycle
 * has elapsed. Singleton concurrency (1) + LIMIT 200 per `step.run()`.
 */
export const operationStalenessAuditCronFn = inngest.createFunction(
  {
    id: "operation-staleness-audit-cron",
    retries: 2,
    concurrency: { limit: INNGEST_CRON_CONCURRENCY },
    triggers: [{ cron: "0 7 * * *" }],
  },
  async ({ step }) => {
    const nowMs = await step.run("capture-clock", () => Date.now());
    let totalChecked = 0;
    let totalEmitted = 0;
    let cursor: string | null = null;

    for (let batch = 0; batch < MAX_BATCHES_PER_INVOCATION; batch += 1) {
      const batchCursor: string | null = cursor;
      const result: {
        candidatesChecked: number;
        eventsEmitted: number;
        lastId: string | null;
      } = await step.run(`scan-stale-page-${batch}`, () =>
        dispatchStaleOperationsBatch({
          limit: STALE_AUDIT_BATCH_SIZE,
          afterId: batchCursor,
          nowMs,
        })
      );
      totalChecked += result.candidatesChecked;
      totalEmitted += result.eventsEmitted;
      cursor = result.lastId;
      if (result.candidatesChecked < STALE_AUDIT_BATCH_SIZE || !cursor) {
        break;
      }
    }

    return { totalChecked, totalEmitted };
  }
);

/**
 * Event-driven delivery worker for stale-operation review nudges.
 * Honors `INNGEST_CONCURRENCY_LIMIT` (default 5 Free-Plan safe; set 25 on Pro).
 */
export const deliverOperationStalenessNudgeFn = inngest.createFunction(
  {
    id: "deliver-operation-staleness-nudge",
    retries: 4,
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    triggers: [{ event: operationStaleAuditEvent }],
  },
  async ({ event, step }) => {
    return deliverStaleOperationNudge(event.data, {
      runStep: async <T,>(id: string, fn: () => Promise<T>): Promise<T> =>
        (await step.run(id, fn)) as unknown as T,
    });
  }
);

/**
 * Delivers in-app + push notifications for existing-user operation invitations
 * and newly reported step flags.
 */
export const sendOperationInviteInAppFn = inngest.createFunction(
  {
    id: "send-operation-invite-in-app",
    retries: 4,
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    triggers: [
      { event: operationInvitedInAppEvent },
      { event: operationStepFlaggedEvent },
    ],
  },
  async ({ event, step }) => {
    if ("flagId" in event.data) {
      const data = event.data;
      const payload: NotificationPayload = {
        userId: data.ownerId,
        type: "operation_step_flagged",
        title: `Step flagged on "${data.operationTitle}"`,
        body: `${data.reporterName}: "${data.messagePreview}"`,
        entityType: "operation",
        entityId: data.operationId,
        deepLink: `/app/operations/${data.operationId}`,
      };
      await step.run("flag-in-app", () => defaultInAppChannel.send(payload));
      await step.run("flag-push", () => defaultWebPushChannel.send(payload));
      return { delivered: true, kind: "step_flagged" };
    }

    const data = event.data;
    const roleLabel =
      data.role === "collaborator" ? "Collaborator" : "Viewer";
    const payload: NotificationPayload = {
      userId: data.targetUserId,
      type: "operation_invited",
      title: `${data.inviterName} shared an operation with you`,
      body: `You've been invited as ${roleLabel} on "${data.operationTitle}".`,
      entityType: "operation_invitation",
      entityId: data.invitationId,
      deepLink: "/app/operations?tab=shared",
    };

    await step.run("invite-in-app", () => defaultInAppChannel.send(payload));
    await step.run("invite-push", () => defaultWebPushChannel.send(payload));
    return { delivered: true, kind: "invited_in_app" };
  }
);

/**
 * Sends external email invitations pointing to `/invite/operation/[token]`.
 * Never logs raw invite URLs or raw email addresses.
 */
export const sendOperationInviteEmailFn = inngest.createFunction(
  {
    id: "send-operation-invite-email",
    retries: 4,
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    triggers: [{ event: operationInvitedEmailEvent }],
  },
  async ({ event, step }) => {
    const { inviterName, operationTitle, role, targetEmail, inviteUrl } =
      event.data;
    const roleLabel = role === "collaborator" ? "Collaborator" : "Viewer";

    return step.run("dispatch-operation-invite-email", async () => {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from =
        process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;

      if (!apiKey) {
        console.info(
          JSON.stringify({
            event: "operation.invite.email_console_fallback",
            to: maskEmail(targetEmail),
            role: roleLabel,
            operationTitle,
          })
        );
        return { delivered: true, provider: "console" };
      }

      const resend = new Resend(apiKey);
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #FAF9F6; color: #1A1917; padding: 28px; border: 1px solid #E5E1D8; border-radius: 8px; max-width: 520px;">
          <p style="font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #5C5851; margin: 0 0 8px;">${escapeHtml(APP_NAME)} · Operations</p>
          <h2 style="font-size: 18px; margin: 0 0 12px;">${escapeHtml(inviterName)} shared an Operation Blueprint with you</h2>
          <p style="font-size: 14px; line-height: 1.55; color: #3D3A34; margin: 0 0 18px;">
            You have been invited as <strong>${escapeHtml(roleLabel)}</strong> on <strong>${escapeHtml(operationTitle)}</strong>. This invitation expires in 7 days.
          </p>
          <a href="${escapeHtml(inviteUrl)}" style="display: inline-block; background: #1A1917; color: #FAF9F6; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: 500;">Review &amp; Accept Invitation</a>
        </div>
      `;

      const res = await resend.emails.send({
        from,
        to: targetEmail,
        subject: `${inviterName} invited you to "${operationTitle}" on ${APP_NAME}`,
        html,
      });

      if (res.error) {
        throw new Error(`Resend operation invite error: ${res.error.message}`);
      }

      return { delivered: true, provider: "resend", id: res.data?.id ?? null };
    });
  }
);
