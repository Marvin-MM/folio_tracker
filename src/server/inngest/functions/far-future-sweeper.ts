import { inngest } from "@/server/inngest/client";
import { reminderService } from "@/server/services/reminder-service";

/**
 * Daily UTC sweeper promoting `pending_far` reminders entering the 14-day horizon
 * to `scheduled` and emitting `app/reminder.scheduled` in bounded batches.
 */
export const farFutureReminderSweeperFn = inngest.createFunction(
  {
    id: "far-future-reminder-sweeper",
    triggers: [{ cron: "0 0 * * *" }],
  },
  async ({ step }) => {
    let totalPromoted = 0;
    let batchNumber = 0;

    while (batchNumber < 20) {
      batchNumber += 1;
      const promotedInBatch = await step.run(
        `promote-far-future-batch-${batchNumber}`,
        async () => reminderService.sweepFarFutureReminders(100)
      );

      totalPromoted += promotedInBatch;
      if (promotedInBatch < 100) {
        break;
      }
    }

    return {
      promoted: totalPromoted,
      batches: batchNumber,
    };
  }
);
