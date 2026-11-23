"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import {
  HABIT_COMMENT_MODES,
  HABIT_MONITOR_SCOPES,
  HABIT_REACTION_TYPES,
  type HabitCommentRecord,
  type HabitMonitorRecord,
  type HabitReactionRecord,
} from "@/server/db/schema";
import {
  habitCommentService,
  habitReactionService,
} from "@/server/services/habit-comment-service";
import { habitMonitorService } from "@/server/services/habit-monitor-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");

const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm (24h).");

const customPolicySchema = z
  .object({
    useCustomPolicy: z.boolean(),
    customCommentMode: z.enum(HABIT_COMMENT_MODES).nullable().optional(),
    customWindowStartDay: z.number().int().min(0).max(6).nullable().optional(),
    customWindowStartTime: z
      .union([timeHHmmSchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    customWindowEndDay: z.number().int().min(0).max(6).nullable().optional(),
    customWindowEndTime: z
      .union([timeHHmmSchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    customIntervalDays: z.number().int().min(2).max(30).nullable().optional(),
    customIntervalAnchorDate: z
      .union([dateKeySchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    customIntervalOpenHours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .nullable()
      .optional(),
    customAllowReactionsWhenLocked: z.boolean().nullable().optional(),
  })
  .nullable()
  .optional();

const inviteCollaboratorSchema = z.object({
  targetUserId: z.string().min(1),
  scope: z.enum(HABIT_MONITOR_SCOPES).default("all"),
  selectedHabitIds: z.array(z.string().min(1)).max(100).optional(),
  customPolicy: customPolicySchema,
});

const inviteEmailSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  scope: z.enum(HABIT_MONITOR_SCOPES).default("all"),
  selectedHabitIds: z.array(z.string().min(1)).max(100).optional(),
  customPolicy: customPolicySchema,
});

const requestIdSchema = z.object({
  requestId: z.string().min(1),
});

const acceptTokenSchema = z.object({
  token: z.string().trim().min(1),
});

const updateMonitorConfigSchema = z.object({
  monitorId: z.string().min(1),
  scope: z.enum(HABIT_MONITOR_SCOPES).optional(),
  selectedHabitIds: z.array(z.string().min(1)).max(100).optional(),
  customPolicy: customPolicySchema,
});

const revokeMonitorSchema = z.object({
  monitorId: z.string().min(1),
});

const createCommentSchema = z.object({
  ownerId: z.string().min(1),
  cycleKey: z.string().trim().min(1).max(40).optional(),
  targetDateKey: z
    .union([dateKeySchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  targetHabitId: z
    .union([z.string().min(1), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  parentCommentId: z.string().min(1).nullable().optional(),
  body: z
    .string()
    .trim()
    .min(1, "Write a comment before posting.")
    .max(1000, "Comment must be 1000 characters or fewer."),
});

const deleteCommentSchema = z.object({
  commentId: z.string().min(1),
  ownerId: z.string().min(1).optional(),
});

const toggleReactionSchema = z.object({
  ownerId: z.string().min(1),
  cycleKey: z.string().trim().min(1).max(40),
  targetDateKey: z
    .union([dateKeySchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  reactionType: z.enum(HABIT_REACTION_TYPES),
});

function revalidateCirclePaths(ownerId?: string) {
  revalidatePath("/app", "layout");
  revalidatePath("/app/habits");
  revalidatePath("/app/habits/circle");
  if (ownerId) {
    revalidatePath(`/app/habits/circle/${ownerId}`);
  }
}

export async function inviteCollaboratorMonitorAction(
  input: z.input<typeof inviteCollaboratorSchema>
): Promise<ActionResult<{ requestId: string; message: string }>> {
  const parsed = inviteCollaboratorSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please check your invitation details."
    );
  }

  try {
    const { user } = await requireSession();
    const res = await habitMonitorService.inviteCollaborator(
      user.id,
      parsed.data
    );
    revalidateCirclePaths();
    return actionOk({ requestId: res.request.id, message: res.message });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function inviteMonitorByEmailAction(
  input: z.input<typeof inviteEmailSchema>
): Promise<ActionResult<{ requestId: string; message: string }>> {
  const parsed = inviteEmailSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please enter a valid email address."
    );
  }

  try {
    const { user } = await requireSession();
    const res = await habitMonitorService.inviteByEmail(user.id, parsed.data);
    revalidateCirclePaths();
    return actionOk({ requestId: res.requestId, message: res.message });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function acceptMonitorRequestAction(
  input: z.input<typeof requestIdSchema>
): Promise<ActionResult<{ ownerId: string; monitorId: string }>> {
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid monitor request.");
  }

  try {
    const { user } = await requireSession();
    const accepted = await habitMonitorService.acceptInAppRequest(
      parsed.data.requestId,
      {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    );
    revalidateCirclePaths(accepted.ownerId);
    return actionOk({
      ownerId: accepted.ownerId,
      monitorId: accepted.monitor.id,
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function declineMonitorRequestAction(
  input: z.input<typeof requestIdSchema>
): Promise<ActionResult<{ declinedId: string }>> {
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid monitor request.");
  }

  try {
    const { user } = await requireSession();
    await habitMonitorService.declineInAppRequest(
      parsed.data.requestId,
      user.id
    );
    revalidateCirclePaths();
    return actionOk({ declinedId: parsed.data.requestId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function revokeMonitorRequestAction(
  input: z.input<typeof requestIdSchema>
): Promise<ActionResult<{ revokedId: string }>> {
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid invitation identifier.");
  }

  try {
    const { user } = await requireSession();
    await habitMonitorService.revokePendingRequest(
      user.id,
      parsed.data.requestId
    );
    revalidateCirclePaths();
    return actionOk({ revokedId: parsed.data.requestId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function acceptHabitInviteTokenAction(
  input: z.input<typeof acceptTokenSchema>
): Promise<ActionResult<{ ownerId: string; monitorId: string }>> {
  const parsed = acceptTokenSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid invitation token.");
  }

  try {
    const { user } = await requireSession();
    const accepted = await habitMonitorService.acceptTokenInvite(
      parsed.data.token,
      {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    );
    revalidateCirclePaths(accepted.ownerId);
    return actionOk({
      ownerId: accepted.ownerId,
      monitorId: accepted.monitor.id,
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateMonitorConfigAction(
  input: z.input<typeof updateMonitorConfigSchema>
): Promise<ActionResult<HabitMonitorRecord>> {
  const parsed = updateMonitorConfigSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid monitor settings."
    );
  }

  try {
    const { user } = await requireSession();
    const { monitorId, ...patch } = parsed.data;
    const updated = await habitMonitorService.updateMonitorConfiguration(
      user.id,
      monitorId,
      patch
    );
    revalidateCirclePaths(user.id);
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function revokeMonitorAction(
  input: z.input<typeof revokeMonitorSchema>
): Promise<ActionResult<{ revokedMonitorId: string }>> {
  const parsed = revokeMonitorSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid monitor identifier.");
  }

  try {
    const { user } = await requireSession();
    await habitMonitorService.revokeMonitor(user.id, parsed.data.monitorId);
    revalidateCirclePaths(user.id);
    return actionOk({ revokedMonitorId: parsed.data.monitorId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function createHabitCommentAction(
  input: z.input<typeof createCommentSchema>
): Promise<ActionResult<HabitCommentRecord>> {
  const parsed = createCommentSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Please check your comment."
    );
  }

  try {
    const { user } = await requireSession();
    const created = await habitCommentService.createComment(
      user.id,
      parsed.data
    );
    revalidateCirclePaths(parsed.data.ownerId);
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteHabitCommentAction(
  input: z.input<typeof deleteCommentSchema>
): Promise<ActionResult<{ deletedId: string }>> {
  const parsed = deleteCommentSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid comment identifier.");
  }

  try {
    const { user } = await requireSession();
    await habitCommentService.deleteComment(user.id, parsed.data.commentId);
    revalidateCirclePaths(parsed.data.ownerId);
    return actionOk({ deletedId: parsed.data.commentId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function toggleHabitReactionAction(
  input: z.input<typeof toggleReactionSchema>
): Promise<
  ActionResult<{ active: boolean; reaction: HabitReactionRecord | null }>
> {
  const parsed = toggleReactionSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid reaction input.");
  }

  try {
    const { user } = await requireSession();
    const res = await habitReactionService.toggleReaction(user.id, parsed.data);
    revalidateCirclePaths(parsed.data.ownerId);
    return actionOk(res);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
