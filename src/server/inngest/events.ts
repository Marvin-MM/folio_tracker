import { eventType } from "inngest";
import { z } from "zod";

export const reminderScheduledEvent = eventType("app/reminder.scheduled", {
  schema: z.object({
    reminderId: z.string(),
    userId: z.string(),
    taskId: z.string().nullable(),
    noteId: z.string().nullable(),
    remindAt: z.number(),
    version: z.number().int().min(1),
  }),
});

export const reminderRescheduledEvent = eventType("app/reminder.rescheduled", {
  schema: z.object({
    reminderId: z.string(),
    userId: z.string(),
    version: z.number().int().min(1),
  }),
});

export const reminderCancelledEvent = eventType("app/reminder.cancelled", {
  schema: z.object({
    reminderId: z.string(),
    userId: z.string(),
    version: z.number().int().min(1),
  }),
});

export const authEmailEvent = eventType("app/auth.email", {
  schema: z.object({
    kind: z.enum(["verification", "password_reset"]),
    to: z.string().email(),
    recipientName: z.string(),
    actionUrl: z.string().url(),
  }),
});

export const testReminderEvent = eventType("app/reminder.test", {
  schema: z.object({
    userId: z.string(),
    timezone: z.string(),
  }),
});

export const projectInvitedEvent = eventType("app/project.invited", {
  schema: z.object({
    invitationId: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    inviterName: z.string(),
    email: z.string().email(),
    role: z.enum(["editor", "viewer"]),
    inviteUrl: z.string().url(),
  }),
});

export const habitNudgeEvent = eventType("app/habit.nudge", {
  schema: z.object({
    userId: z.string(),
    dateKey: z.string(),
    slot: z.string(),
    kind: z.enum(["habit_preferred", "evening_checkin"]),
    habitId: z.string().nullable(),
    dedupKey: z.string(),
    timezone: z.string(),
  }),
});

export const habitMonitorRequestedEvent = eventType(
  "app/habit.monitor_requested",
  {
    schema: z.object({
      requestId: z.string(),
      ownerId: z.string(),
      ownerName: z.string(),
      targetUserId: z.string(),
      scope: z.enum(["all", "selected"]),
    }),
  }
);

export const habitMonitorInvitedEvent = eventType("app/habit.monitor_invited", {
  schema: z.object({
    requestId: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    targetEmail: z.string().email(),
    scope: z.enum(["all", "selected"]),
    inviteUrl: z.string().url(),
  }),
});

export const habitReviewDigestEvent = eventType("app/habit.review_digest", {
  schema: z.object({
    monitorId: z.string(),
    ownerId: z.string(),
    monitorUserId: z.string(),
    cycleKey: z.string(),
    periodStartDate: z.string(),
    periodEndDate: z.string(),
    dedupKey: z.string(),
  }),
});

export const habitStreakRiskEvent = eventType("app/habit.streak_at_risk", {
  schema: z.object({
    groupId: z.string(),
    groupName: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    ownerTimezone: z.string(),
    recipientId: z.string(),
    recipientName: z.string(),
    recipientTimezone: z.string(),
    habitId: z.string(),
    habitTitle: z.string(),
    dateKey: z.string(),
    currentStreak: z.number().int().min(1),
    streakUnit: z.enum(["days", "weeks"]),
    reason: z.enum(["unlogged", "missed"]),
    dedupKey: z.string(),
  }),
});

export const habitCommentPostedEvent = eventType("app/habit.comment_posted", {
  schema: z.object({
    commentId: z.string(),
    ownerId: z.string(),
    authorId: z.string(),
    authorName: z.string(),
    recipientUserId: z.string(),
    cycleKey: z.string(),
    bodyPreview: z.string(),
    deepLink: z.string(),
  }),
});
