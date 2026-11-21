"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import {
  REMINDER_ENTITY_TYPES,
  type ReminderRecord,
} from "@/server/db/schema";
import { reminderService } from "@/server/services/reminder-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const attachReminderSchema = z.object({
  entityType: z.enum(REMINDER_ENTITY_TYPES),
  entityId: z.string().min(1),
  remindAt: z.number().int().positive(),
});

const rescheduleReminderSchema = z.object({
  reminderId: z.string().min(1),
  remindAt: z.number().int().positive(),
  expectedVersion: z.number().int().min(1).optional(),
});

const snoozeReminderSchema = z.object({
  reminderId: z.string().min(1),
  preset: z.enum(["15m", "1h", "tomorrow_9am"]),
  expectedVersion: z.number().int().min(1).optional(),
});

const cancelReminderSchema = z.object({
  reminderId: z.string().min(1),
  expectedVersion: z.number().int().min(1).optional(),
});

function revalidateReminderPaths() {
  revalidatePath("/app", "layout");
  revalidatePath("/app/inbox");
  revalidatePath("/app/today");
  revalidatePath("/app/upcoming");
  revalidatePath("/app/reminders");
  revalidatePath("/app/notes");
  revalidatePath("/app/projects", "layout");
}

export async function attachReminderAction(
  input: z.input<typeof attachReminderSchema>
): Promise<ActionResult<ReminderRecord>> {
  const parsed = attachReminderSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid reminder time.");
  }

  try {
    const { user } = await requireSession();
    const created = await reminderService.attachReminder(user.id, {
      ...parsed.data,
      timezone: user.timezone || "UTC",
    });
    revalidateReminderPaths();
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function rescheduleReminderAction(
  input: z.input<typeof rescheduleReminderSchema>
): Promise<ActionResult<ReminderRecord>> {
  const parsed = rescheduleReminderSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid reminder schedule.");
  }

  try {
    const { user } = await requireSession();
    const updated = await reminderService.rescheduleReminder(
      user.id,
      parsed.data.reminderId,
      {
        remindAt: parsed.data.remindAt,
        timezone: user.timezone || "UTC",
        expectedVersion: parsed.data.expectedVersion,
      }
    );
    revalidateReminderPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function snoozeReminderAction(
  input: z.input<typeof snoozeReminderSchema>
): Promise<ActionResult<ReminderRecord>> {
  const parsed = snoozeReminderSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid snooze option.");
  }

  try {
    const { user } = await requireSession();
    const updated = await reminderService.snoozeReminder(
      user.id,
      parsed.data.reminderId,
      parsed.data.preset,
      user.timezone || "UTC",
      parsed.data.expectedVersion
    );
    revalidateReminderPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function cancelReminderAction(
  input: z.input<typeof cancelReminderSchema>
): Promise<ActionResult<ReminderRecord>> {
  const parsed = cancelReminderSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid reminder identifier.");
  }

  try {
    const { user } = await requireSession();
    const updated = await reminderService.cancelReminder(
      user.id,
      parsed.data.reminderId,
      parsed.data.expectedVersion
    );
    revalidateReminderPaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
