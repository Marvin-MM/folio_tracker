import { serve } from "inngest/next";
import { inngest } from "@/server/inngest/client";
import { farFutureReminderSweeperFn } from "@/server/inngest/functions/far-future-sweeper";
import { reconcileUndispatchedRemindersFn } from "@/server/inngest/functions/reconcile-undispatched-reminders";
import { scheduleReminderFn } from "@/server/inngest/functions/schedule-reminder";
import { sendAuthEmailFn } from "@/server/inngest/functions/send-auth-email";
import { sendProjectInviteFn } from "@/server/inngest/functions/send-project-invite";
import { sendTestReminderFn } from "@/server/inngest/functions/send-test-reminder";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    scheduleReminderFn,
    farFutureReminderSweeperFn,
    reconcileUndispatchedRemindersFn,
    sendAuthEmailFn,
    sendTestReminderFn,
    sendProjectInviteFn,
  ],
});
