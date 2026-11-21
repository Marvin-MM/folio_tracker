"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import {
  INVITATION_ROLES,
  type ProjectInvitationRecord,
  type ProjectRecord,
} from "@/server/db/schema";
import { projectInviteService } from "@/server/services/project-invite-service";
import {
  PROJECT_COLOR_TOKENS,
  projectService,
} from "@/server/services/project-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(100),
  description: z.string().max(1000).nullable().optional(),
  colorToken: z.enum(PROJECT_COLOR_TOKENS).optional(),
});

const updateProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "Project name is required.").max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  colorToken: z.enum(PROJECT_COLOR_TOKENS).optional(),
  isArchived: z.boolean().optional(),
});

const projectIdSchema = z.object({
  projectId: z.string().min(1),
});

const createInviteSchema = z.object({
  projectId: z.string().min(1),
  email: z.string().trim().email("Please enter a valid email address."),
  role: z.enum(INVITATION_ROLES),
});

const revokeInviteSchema = z.object({
  projectId: z.string().min(1),
  invitationId: z.string().min(1),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1),
});

const updateMemberRoleSchema = z.object({
  projectId: z.string().min(1),
  targetUserId: z.string().min(1),
  role: z.enum(INVITATION_ROLES),
});

const removeMemberSchema = z.object({
  projectId: z.string().min(1),
  targetUserId: z.string().min(1),
});

function revalidateProjectPaths(projectId?: string) {
  revalidatePath("/app", "layout");
  if (projectId) {
    revalidatePath(`/app/projects/${projectId}`);
  }
}

export async function createProjectAction(
  input: z.input<typeof createProjectSchema>
): Promise<ActionResult<ProjectRecord>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your project details.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const project = await projectService.createProject(user.id, parsed.data);
    revalidateProjectPaths(project.id);
    return actionOk(project);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateProjectAction(
  input: z.input<typeof updateProjectSchema>
): Promise<ActionResult<ProjectRecord>> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your project settings.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const { projectId, ...patch } = parsed.data;
    const updated = await projectService.updateProject(
      projectId,
      user.id,
      patch
    );
    revalidateProjectPaths(projectId);
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteProjectAction(
  input: z.input<typeof projectIdSchema>
): Promise<ActionResult<{ deletedId: string }>> {
  const parsed = projectIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid project identifier.");
  }

  try {
    const { user } = await requireSession();
    await projectService.deleteProject(parsed.data.projectId, user.id);
    revalidateProjectPaths();
    return actionOk({ deletedId: parsed.data.projectId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function createProjectInvitationAction(
  input: z.input<typeof createInviteSchema>
): Promise<
  ActionResult<{ invitation: ProjectInvitationRecord; invitePath: string }>
> {
  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please enter a valid email and role.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const created = await projectInviteService.createInvitation(
      parsed.data.projectId,
      user.id,
      { email: parsed.data.email, role: parsed.data.role }
    );
    revalidateProjectPaths(parsed.data.projectId);
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function revokeProjectInvitationAction(
  input: z.input<typeof revokeInviteSchema>
): Promise<ActionResult<{ revokedId: string }>> {
  const parsed = revokeInviteSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid invitation identifier.");
  }

  try {
    const { user } = await requireSession();
    await projectInviteService.revokeInvitation(
      parsed.data.projectId,
      user.id,
      parsed.data.invitationId
    );
    revalidateProjectPaths(parsed.data.projectId);
    return actionOk({ revokedId: parsed.data.invitationId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function acceptProjectInvitationAction(
  input: z.input<typeof acceptInviteSchema>
): Promise<ActionResult<{ projectId: string; alreadyMember: boolean }>> {
  const parsed = acceptInviteSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Missing invitation token.");
  }

  try {
    const { user } = await requireSession();
    const result = await projectInviteService.acceptInvitation(
      parsed.data.token,
      {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    );
    revalidateProjectPaths(result.projectId);
    return actionOk({
      projectId: result.projectId,
      alreadyMember: result.alreadyMember,
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateProjectMemberRoleAction(
  input: z.input<typeof updateMemberRoleSchema>
): Promise<ActionResult<{ updated: boolean }>> {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid role update request.");
  }

  try {
    const { user } = await requireSession();
    await projectService.updateMemberRole(
      parsed.data.projectId,
      user.id,
      parsed.data.targetUserId,
      parsed.data.role
    );
    revalidateProjectPaths(parsed.data.projectId);
    return actionOk({ updated: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function removeProjectMemberAction(
  input: z.input<typeof removeMemberSchema>
): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid member removal request.");
  }

  try {
    const { user } = await requireSession();
    await projectService.removeMember(
      parsed.data.projectId,
      user.id,
      parsed.data.targetUserId
    );
    revalidateProjectPaths(parsed.data.projectId);
    return actionOk({ removed: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
