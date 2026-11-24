import { farFutureReminderSweeperFn } from "@/server/inngest/functions/far-future-sweeper";
import { reconcileUndispatchedRemindersFn } from "@/server/inngest/functions/reconcile-undispatched-reminders";
import { scheduleReminderFn } from "@/server/inngest/functions/schedule-reminder";
import { sendAuthEmailFn } from "@/server/inngest/functions/send-auth-email";
import { sendProjectInviteFn } from "@/server/inngest/functions/send-project-invite";
import { sendTestReminderFn } from "@/server/inngest/functions/send-test-reminder";
import {
  deliverHabitNudgeFn,
  habitNudgeDispatcherFn,
} from "@/server/inngest/habit-reminders";
import {
  deliverHabitStreakRiskFn,
  habitStreakRiskCronFn,
} from "@/server/inngest/habit-streak-nudges";
import {
  deliverHabitReviewDigestFn,
  habitReviewDigestCronFn,
  sendHabitCommentNotificationFn,
  sendHabitMonitorInviteFn,
  sendHabitMonitorRequestFn,
} from "@/server/inngest/habit-review-digest";

export const inngestFunctions = [
  scheduleReminderFn,
  farFutureReminderSweeperFn,
  reconcileUndispatchedRemindersFn,
  sendAuthEmailFn,
  sendTestReminderFn,
  sendProjectInviteFn,
  habitNudgeDispatcherFn,
  deliverHabitNudgeFn,
  habitReviewDigestCronFn,
  deliverHabitReviewDigestFn,
  sendHabitMonitorRequestFn,
  sendHabitMonitorInviteFn,
  sendHabitCommentNotificationFn,
  habitStreakRiskCronFn,
  deliverHabitStreakRiskFn,
];
