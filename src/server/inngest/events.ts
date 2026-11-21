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
