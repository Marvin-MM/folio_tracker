import {
  INNGEST_CRON_CONCURRENCY,
  inngest,
} from "@/server/inngest/client";
import {
  DEFAULT_OUTBOX_MIN_AGE_MS,
  DEFAULT_SWEEPER_BATCH_SIZE,
  reminderService,
} from "@/server/services/reminder-service";

const MAX_BATCHES_PER_INVOCATION = 50;

/**
 * Outbox Reconciliation cron (every 5 minutes):
 * Queries `status = 'scheduled' AND dispatched_at IS NULL AND updated_at <= now - 60s`
 * in bounded `LIMIT 200` chunks inside isolated `step.run()` calls so Vercel
 * serverless invocations stay well under 10s even during large backlogs.
 */
export const reconcileUndispatchedRemindersFn = inngest.createFunction(
  {
    id: "reconcile-undispatched-reminders",
    concurrency: { limit: INNGEST_CRON_CONCURRENCY },
    retries: 4,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    let totalReconciled = 0;
    let batchNumber = 0;

    while (batchNumber < MAX_BATCHES_PER_INVOCATION) {
      batchNumber += 1;
      const reconciledInBatch = await step.run(
        `batch-${batchNumber}`,
        async () =>
          reminderService.reconcileUndispatchedBatch(
            DEFAULT_SWEEPER_BATCH_SIZE,
            DEFAULT_OUTBOX_MIN_AGE_MS
          )
      );

      totalReconciled += reconciledInBatch;
      if (reconciledInBatch < DEFAULT_SWEEPER_BATCH_SIZE) {
        break;
      }
    }

    return {
      reconciled: totalReconciled,
      batches: batchNumber,
    };
  }
);
