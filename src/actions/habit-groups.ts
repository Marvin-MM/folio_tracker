"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import { HABIT_GROUP_ROLES } from "@/server/db/schema";
import { habitGroupService } from "@/server/services/habit-group-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(254);

const createGroupSchema = z.object({
  name: z.string().trim().min(2, "Give the group a name.").max(80),
  description: z.string().trim().max(280).optional().nullable(),
  memberEmails: z.array(emailSchema).min(2, "Add at least two partners.").max(49),
});

const groupIdSchema = z.object({ groupId: z.string().min(1) });

const addMemberSchema = groupIdSchema.extend({
  email: emailSchema,
});

const setRoleSchema = groupIdSchema.extend({
  userId: z.string().min(1),
  role: z.enum(HABIT_GROUP_ROLES).refine((role) => role !== "owner", {
    message: "Ownership cannot be reassigned.",
  }),
});

const removeMemberSchema = groupIdSchema.extend({
  userId: z.string().min(1),
});

const habitSchema = groupIdSchema.extend({
  habitId: z.string().min(1),
});

function revalidateGroupPaths(groupId?: string) {
  revalidatePath("/app", "layout");
  revalidatePath("/app/habits");
  revalidatePath("/app/habits/groups");
  if (groupId) revalidatePath(`/app/habits/groups/${groupId}`);
}

function validationError<T>(
  error: z.ZodError,
  fallback: string
): ActionResult<T> {
  return actionErr("VALIDATION_ERROR", error.issues[0]?.message ?? fallback);
}

export async function createHabitGroupAction(
  input: z.input<typeof createGroupSchema>
): Promise<ActionResult<{ groupId: string }>> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid group details.");
  }
  try {
    const { user } = await requireSession();
    const group = await habitGroupService.createGroup(user.id, parsed.data);
    revalidateGroupPaths(group.id);
    return actionOk({ groupId: group.id });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function addGroupMemberAction(
  input: z.input<typeof addMemberSchema>
): Promise<ActionResult<{ userId: string }>> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid member.");
  }
  try {
    const { user } = await requireSession();
    const member = await habitGroupService.addMemberByEmail(
      user.id,
      parsed.data.groupId,
      parsed.data.email
    );
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ userId: member.userId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function setGroupMemberRoleAction(
  input: z.input<typeof setRoleSchema>
): Promise<ActionResult<{ userId: string }>> {
  const parsed = setRoleSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid role.");
  }
  try {
    const { user } = await requireSession();
    await habitGroupService.setMemberRole(
      user.id,
      parsed.data.groupId,
      parsed.data.userId,
      parsed.data.role
    );
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ userId: parsed.data.userId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function removeGroupMemberAction(
  input: z.input<typeof removeMemberSchema>
): Promise<ActionResult<{ userId: string }>> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid member.");
  }
  try {
    const { user } = await requireSession();
    await habitGroupService.removeMember(
      user.id,
      parsed.data.groupId,
      parsed.data.userId
    );
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ userId: parsed.data.userId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function leaveHabitGroupAction(
  input: z.input<typeof groupIdSchema>
): Promise<ActionResult<{ groupId: string }>> {
  const parsed = groupIdSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid group.");
  }
  try {
    const { user } = await requireSession();
    await habitGroupService.leaveGroup(user.id, parsed.data.groupId);
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ groupId: parsed.data.groupId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function shareGroupHabitAction(
  input: z.input<typeof habitSchema>
): Promise<ActionResult<{ habitId: string }>> {
  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid habit.");
  }
  try {
    const { user } = await requireSession();
    await habitGroupService.shareHabit(
      user.id,
      parsed.data.groupId,
      parsed.data.habitId
    );
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ habitId: parsed.data.habitId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function unshareGroupHabitAction(
  input: z.input<typeof habitSchema>
): Promise<ActionResult<{ habitId: string }>> {
  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error, "Invalid habit.");
  }
  try {
    const { user } = await requireSession();
    await habitGroupService.unshareHabit(
      user.id,
      parsed.data.groupId,
      parsed.data.habitId
    );
    revalidateGroupPaths(parsed.data.groupId);
    return actionOk({ habitId: parsed.data.habitId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
