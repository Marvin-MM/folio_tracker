import { inngest } from "@/server/inngest/client";
import {
  DEFAULT_SWEEPER_BATCH_SIZE,
  reminderService,
} from "@/server/services/reminder-service";

const MAX_BATCHES_PER_INVOCATION = 50;

/**
 * Daily UTC sweeper promoting `pending_far` reminders entering the 14-day horizon
 * to `scheduled` in bounded `LIMIT 200` chunks inside isolated `step.run()` steps
 * with batched deterministic `inngest.send()` calls.
 */
export const farFutureReminderSweeperFn = inngest.createFunction(
  {
    id: "far-future-reminder-sweeper",
    retries: 4,
    triggers: [{ cron: "0 0 * * *" }],
  },
  async ({ step }) => {
    let totalPromoted = 0;
    let batchNumber = 0;

    while (batchNumber < MAX_BATCHES_PER_INVOCATION) {
      batchNumber += 1;
      const promotedInBatch = await step.run(`batch-${batchNumber}`, async () =>
        reminderService.sweepFarFutureReminders(DEFAULT_SWEEPER_BATCH_SIZE)
      );

      totalPromoted += promotedInBatch;
      if (promotedInBatch < DEFAULT_SWEEPER_BATCH_SIZE) {
        break;
      }
    }

    return {
      promoted: totalPromoted,
      batches: batchNumber,
    };
  }
);
