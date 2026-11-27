"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "@/actions/types";
import { requireSession } from "@/server/dal/auth-guard";
import { invalidatePublicOperationTags } from "@/server/dal/public-operations-cache";
import {
  OPERATION_MEMBER_ROLES,
  TASK_PRIORITIES,
  type OperationMemberRecord,
  type OperationRecord,
  type OperationRunRecord,
  type OperationRunStepRecord,
  type OperationStepFlagRecord,
  type ReminderRecord,
  type TaskRecord,
} from "@/server/db/schema";
import {
  MAX_OPERATION_SUMMARY_LENGTH,
  MAX_OPERATION_TITLE_LENGTH,
  MAX_REFERENCE_NOTES,
  MAX_RUN_STEP_NOTE_LENGTH,
  operationDifficultySchema,
  operationDomainSchema,
  operationPrerequisitesSchemaArray,
  operationRunStepStatusSchema,
  operationStepsSchemaArray,
  operationTagsSchema,
  operationVariablesSchemaArray,
  operationVisibilitySchema,
  scanOperationForSecrets,
  type SecretScanReport,
} from "@/server/domain/operations";
import {
  MAX_STEP_FLAG_MESSAGE_LENGTH,
  operationFlagService,
} from "@/server/services/operation-flag-service";
import {
  operationRunService,
  type CompleteRunResult,
  type OperationRunDetailPayload,
} from "@/server/services/operation-run-service";
import {
  operationService,
  type OperationMutationResult,
  type OperationVisibilityMutationResult,
} from "@/server/services/operation-service";
import {
  operationShareService,
  type SendOperationInviteResult,
} from "@/server/services/operation-share-service";
import { operationSocialService } from "@/server/services/operation-social-service";

const blueprintBaseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(MAX_OPERATION_TITLE_LENGTH),
  summary: z.string().trim().max(MAX_OPERATION_SUMMARY_LENGTH).optional(),
  domain: operationDomainSchema.default("general"),
  tags: operationTagsSchema.optional(),
  difficulty: operationDifficultySchema.nullish(),
  estimatedMinutes: z.number().int().min(1).max(10080).nullish(),
  visibility: operationVisibilitySchema.default("private"),
  allowForking: z.boolean().optional(),
  shareWithProject: z.boolean().optional(),
  reviewCycleDays: z.number().int().min(1).max(3650).nullish(),
  projectId: z.string().trim().min(1).nullish(),
  linkedHabitId: z.string().trim().min(1).nullish(),
  referenceNoteIds: z
    .array(z.string().trim().min(1))
    .max(MAX_REFERENCE_NOTES)
    .optional(),
  variables: operationVariablesSchemaArray.optional(),
  prerequisites: operationPrerequisitesSchemaArray.optional(),
  steps: operationStepsSchemaArray,
  changeSummary: z.string().trim().max(240).nullish(),
  acknowledgeWarnings: z.boolean().optional(),
});

const publishVersionSchema = blueprintBaseSchema.extend({
  operationId: z.string().trim().min(1),
  expectedEditVersion: z.number().int().min(1),
});

const rollbackVersionSchema = z.object({
  operationId: z.string().trim().min(1),
  targetVersionNumber: z.number().int().min(1),
  expectedEditVersion: z.number().int().min(1),
  changeSummary: z.string().trim().max(240).nullish(),
  acknowledgeWarnings: z.boolean().optional(),
});

const updateVisibilitySchema = z.object({
  operationId: z.string().trim().min(1),
  visibility: operationVisibilitySchema,
  allowForking: z.boolean().optional(),
  acknowledgeWarnings: z.boolean().optional(),
});

const updateProjectSharingSchema = z.object({
  operationId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).nullable(),
  shareWithProject: z.boolean(),
});

const forkOperationSchema = z.object({
  operationId: z.string().trim().min(1),
  unlistedToken: z.string().trim().min(1).nullish(),
});

const archiveOperationSchema = z.object({
  operationId: z.string().trim().min(1),
  isArchived: z.boolean(),
});

const operationIdSchema = z.object({
  operationId: z.string().trim().min(1),
});

const scheduleRunTaskSchema = z.object({
  operationId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: z.number().int().positive().nullish(),
  remindAt: z.number().int().positive().nullish(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

const startRunSchema = z.object({
  operationId: z.string().trim().min(1),
  title: z.string().trim().max(160).optional(),
  variablesValues: z.record(z.string(), z.string().max(1000)).optional(),
  prerequisitesChecked: z
    .array(z.string().trim().min(1).max(64))
    .max(50)
    .optional(),
  unlistedToken: z.string().trim().min(1).nullish(),
});

const updateRunPreflightSchema = z.object({
  runId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  variablesValues: z.record(z.string(), z.string().max(1000)).optional(),
  prerequisitesChecked: z
    .array(z.string().trim().min(1).max(64))
    .max(50)
    .optional(),
});

const updateRunStepSchema = z.object({
  runId: z.string().trim().min(1),
  stepKey: z.string().trim().min(1).max(64),
  status: operationRunStepStatusSchema,
  note: z.string().max(MAX_RUN_STEP_NOTE_LENGTH).nullish(),
});

const syncOfflineRunSchema = z.object({
  runId: z.string().trim().min(1),
  preflight: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      variablesValues: z.record(z.string(), z.string().max(1000)).optional(),
      prerequisitesChecked: z
        .array(z.string().trim().min(1).max(64))
        .max(50)
        .optional(),
    })
    .optional(),
  stepUpdates: z
    .array(
      z.object({
        stepKey: z.string().trim().min(1).max(64),
        status: operationRunStepStatusSchema,
        note: z.string().max(MAX_RUN_STEP_NOTE_LENGTH).nullish(),
      })
    )
    .max(200)
    .optional(),
});

const completeRunSchema = z.object({
  runId: z.string().trim().min(1),
  markOperationVerified: z.boolean().optional(),
  autoLogLinkedHabit: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

const runIdSchema = z.object({
  runId: z.string().trim().min(1),
});

const createBlockedStepTaskSchema = z.object({
  runId: z.string().trim().min(1),
  stepKey: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  dueAt: z.number().int().positive().nullish(),
  remindAt: z.number().int().positive().nullish(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  markStepBlocked: z.boolean().optional(),
});

const inviteQuickPickSchema = z.object({
  operationId: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
  role: z.enum(OPERATION_MEMBER_ROLES),
});

const inviteByEmailSchema = z.object({
  operationId: z.string().trim().min(1),
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(OPERATION_MEMBER_ROLES),
});

const invitationIdSchema = z.object({
  invitationId: z.string().trim().min(1),
});

const acceptTokenInviteSchema = z.object({
  token: z.string().trim().min(16),
});

const revokeInvitationSchema = z.object({
  operationId: z.string().trim().min(1),
  invitationId: z.string().trim().min(1),
});

const memberMutationSchema = z.object({
  operationId: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
  role: z.enum(OPERATION_MEMBER_ROLES).optional(),
});

const flagStepSchema = z.object({
  operationId: z.string().trim().min(1),
  stepKey: z.string().trim().min(1).max(64),
  versionNumber: z.number().int().min(1).optional(),
  message: z
    .string()
    .trim()
    .min(1, "Describe what is outdated or unclear.")
    .max(MAX_STEP_FLAG_MESSAGE_LENGTH),
  unlistedToken: z.string().trim().min(1).nullish(),
});

const resolveFlagSchema = z.object({
  operationId: z.string().trim().min(1),
  flagId: z.string().trim().min(1),
});

const followCreatorSchema = z.object({
  targetUserId: z.string().trim().min(1),
  follow: z.boolean(),
});

function revalidateOperationRoutes(params: {
  operationId?: string;
  runId?: string;
  slug?: string | null;
  ownerHandle?: string | null;
}) {
  revalidatePath("/app/operations");
  if (params.operationId) {
    revalidatePath(`/app/operations/${params.operationId}`);
    revalidatePath(`/app/operations/${params.operationId}/edit`);
  }
  if (params.runId) {
    revalidatePath(`/app/operations/runs/${params.runId}`);
  }
  if (params.slug) {
    revalidatePath(`/ops/${params.slug}`);
  }
  if (params.ownerHandle) {
    revalidatePath(`/u/${params.ownerHandle}`);
  }
  revalidatePath("/explore");
  invalidatePublicOperationTags({
    slug: params.slug,
    ownerHandle: params.ownerHandle,
  });
}

export async function scanOperationDraftAction(
  raw: z.input<typeof blueprintBaseSchema>
): Promise<ActionResult<SecretScanReport>> {
  try {
    await requireSession();
    const report = scanOperationForSecrets({
      title: raw.title,
      summary: raw.summary,
      variables: raw.variables?.map((v) => ({
        ...v,
        type: v.type ?? "text",
        required: v.required ?? false,
      })),
      prerequisites: raw.prerequisites,
      steps: raw.steps?.map((s) => ({
        ...s,
        type: s.type ?? "action",
        bodyMarkdown: s.bodyMarkdown ?? "",
        codeBlock: s.codeBlock
          ? {
              language: s.codeBlock.language ?? "bash",
              content: s.codeBlock.content,
            }
          : null,
      })),
    });
    return actionOk(report);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function createOperationAction(
  raw: z.input<typeof blueprintBaseSchema>
): Promise<ActionResult<OperationMutationResult>> {
  try {
    const { user } = await requireSession();
    const parsed = blueprintBaseSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Please check the blueprint fields.",
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await operationService.createOperation(user.id, parsed.data);
    revalidateOperationRoutes({
      operationId: result.operation.id,
      slug: result.operation.slug,
      ownerHandle: result.ownerHandle,
    });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function publishOperationVersionAction(
  raw: z.input<typeof publishVersionSchema>
): Promise<ActionResult<OperationMutationResult>> {
  try {
    const { user } = await requireSession();
    const parsed = publishVersionSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Please check the blueprint fields.",
        parsed.error.flatten().fieldErrors
      );
    }

    const { operationId, ...payload } = parsed.data;
    const result = await operationService.publishNewVersion(
      user.id,
      operationId,
      payload
    );
    revalidateOperationRoutes({
      operationId,
      slug: result.operation.slug,
      ownerHandle: result.ownerHandle,
    });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateOperationVisibilityAction(
  raw: z.input<typeof updateVisibilitySchema>
): Promise<ActionResult<OperationVisibilityMutationResult>> {
  try {
    const { user } = await requireSession();
    const parsed = updateVisibilitySchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid visibility settings.");
    }

    const result = await operationService.updateVisibility(
      user.id,
      parsed.data.operationId,
      {
        visibility: parsed.data.visibility,
        allowForking: parsed.data.allowForking,
        acknowledgeWarnings: parsed.data.acknowledgeWarnings,
      }
    );
    revalidateOperationRoutes({
      operationId: result.operation.id,
      slug: result.operation.slug,
      ownerHandle: result.ownerHandle,
    });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function rotateUnlistedOperationLinkAction(
  raw: z.input<typeof operationIdSchema>
): Promise<
  ActionResult<{ operation: OperationRecord; mintedUnlistedToken: string }>
> {
  try {
    const { user } = await requireSession();
    const parsed = operationIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid operation ID.");
    }
    const result = await operationService.rotateUnlistedToken(
      user.id,
      parsed.data.operationId
    );
    revalidateOperationRoutes({
      operationId: result.operation.id,
      slug: result.operation.slug,
    });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateOperationProjectSharingAction(
  raw: z.input<typeof updateProjectSharingSchema>
): Promise<ActionResult<OperationRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = updateProjectSharingSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid project sharing settings.");
    }
    const updated = await operationService.updateProjectSharing(
      user.id,
      parsed.data.operationId,
      {
        projectId: parsed.data.projectId,
        shareWithProject: parsed.data.shareWithProject,
      }
    );
    revalidateOperationRoutes({ operationId: updated.id });
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function forkOperationAction(
  raw: z.input<typeof forkOperationSchema>
): Promise<
  ActionResult<{
    forked: OperationRecord;
    newForkCount: number;
  }>
> {
  try {
    const { user } = await requireSession();
    const parsed = forkOperationSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid fork request.");
    }
    const result = await operationService.forkOperation(
      user.id,
      parsed.data.operationId,
      parsed.data.unlistedToken
    );
    revalidateOperationRoutes({
      operationId: result.forked.id,
      slug: result.sourceSlug,
      ownerHandle: result.sourceOwnerHandle,
    });
    return actionOk({
      forked: result.forked,
      newForkCount: result.newForkCount,
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function rollbackOperationVersionAction(
  raw: z.input<typeof rollbackVersionSchema>
): Promise<ActionResult<OperationMutationResult>> {
  try {
    const { user } = await requireSession();
    const parsed = rollbackVersionSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid rollback request.",
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await operationService.rollbackToVersion(
      user.id,
      parsed.data.operationId,
      {
        targetVersionNumber: parsed.data.targetVersionNumber,
        expectedEditVersion: parsed.data.expectedEditVersion,
        changeSummary: parsed.data.changeSummary,
        acknowledgeWarnings: parsed.data.acknowledgeWarnings,
      }
    );
    revalidateOperationRoutes({
      operationId: parsed.data.operationId,
      slug: result.operation.slug,
      ownerHandle: result.ownerHandle,
    });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function archiveOperationAction(
  raw: z.input<typeof archiveOperationSchema>
): Promise<ActionResult<OperationRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = archiveOperationSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid archive request.");
    }
    const { operation: updated, ownerHandle } =
      await operationService.archiveOperation(
        user.id,
        parsed.data.operationId,
        parsed.data.isArchived
      );
    revalidateOperationRoutes({
      operationId: updated.id,
      slug: updated.slug,
      ownerHandle,
    });
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteOperationAction(
  raw: z.input<typeof operationIdSchema>
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const { user } = await requireSession();
    const parsed = operationIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid operation ID.");
    }
    const { slug, ownerHandle } = await operationService.deleteOperation(
      user.id,
      parsed.data.operationId
    );
    revalidateOperationRoutes({
      operationId: parsed.data.operationId,
      slug,
      ownerHandle,
    });
    return actionOk({ deleted: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function markOperationVerifiedAction(
  raw: z.input<typeof operationIdSchema>
): Promise<ActionResult<OperationRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = operationIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid operation ID.");
    }
    const { operation: updated, ownerHandle } =
      await operationService.markVerified(user.id, parsed.data.operationId);
    revalidateOperationRoutes({
      operationId: updated.id,
      slug: updated.slug,
      ownerHandle,
    });
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function scheduleOperationRunTaskAction(
  raw: z.input<typeof scheduleRunTaskSchema>
): Promise<ActionResult<{ task: TaskRecord; reminder: ReminderRecord | null }>> {
  try {
    const { user } = await requireSession();
    const parsed = scheduleRunTaskSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid schedule request.",
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await operationService.scheduleOperationRunTask(
      user.id,
      parsed.data.operationId,
      {
        title: parsed.data.title,
        dueAt: parsed.data.dueAt,
        remindAt: parsed.data.remindAt,
        priority: parsed.data.priority,
        timezone: parsed.data.timezone ?? user.timezone ?? "UTC",
      }
    );

    revalidatePath("/app/inbox");
    revalidatePath("/app/today");
    revalidatePath("/app/upcoming");
    revalidatePath("/app/reminders");
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function startOperationRunAction(
  raw: z.input<typeof startRunSchema>
): Promise<ActionResult<OperationRunDetailPayload>> {
  try {
    const { user } = await requireSession();
    const parsed = startRunSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Unable to start run.",
        parsed.error.flatten().fieldErrors
      );
    }

    const detail = await operationRunService.startRun(
      user.id,
      parsed.data.operationId,
      {
        title: parsed.data.title,
        variablesValues: parsed.data.variablesValues,
        prerequisitesChecked: parsed.data.prerequisitesChecked,
        unlistedToken: parsed.data.unlistedToken,
      }
    );
    revalidateOperationRoutes({
      operationId: parsed.data.operationId,
      runId: detail.run.id,
    });
    return actionOk(detail);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateOperationRunPreflightAction(
  raw: z.input<typeof updateRunPreflightSchema>
): Promise<ActionResult<OperationRunRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = updateRunPreflightSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid preflight update.",
        parsed.error.flatten().fieldErrors
      );
    }

    const updated = await operationRunService.updateRunPreflight(
      user.id,
      parsed.data.runId,
      {
        title: parsed.data.title,
        variablesValues: parsed.data.variablesValues,
        prerequisitesChecked: parsed.data.prerequisitesChecked,
      }
    );
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateOperationRunStepAction(
  raw: z.input<typeof updateRunStepSchema>
): Promise<ActionResult<OperationRunStepRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = updateRunStepSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid step update.",
        parsed.error.flatten().fieldErrors
      );
    }

    const updated = await operationRunService.updateRunStep(
      user.id,
      parsed.data.runId,
      {
        stepKey: parsed.data.stepKey,
        status: parsed.data.status,
        note: parsed.data.note,
      }
    );
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function syncOfflineRunMutationsAction(
  raw: z.input<typeof syncOfflineRunSchema>
): Promise<ActionResult<OperationRunDetailPayload>> {
  try {
    const { user } = await requireSession();
    const parsed = syncOfflineRunSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid offline sync payload."
      );
    }

    const detail = await operationRunService.syncOfflineRunMutations(
      user.id,
      parsed.data.runId,
      {
        preflight: parsed.data.preflight,
        stepUpdates: parsed.data.stepUpdates,
      }
    );
    revalidateOperationRoutes({
      operationId: detail.operation.id,
      runId: detail.run.id,
    });
    return actionOk(detail);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function completeOperationRunAction(
  raw: z.input<typeof completeRunSchema>
): Promise<ActionResult<CompleteRunResult>> {
  try {
    const { user } = await requireSession();
    const parsed = completeRunSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid complete run request.");
    }

    const result = await operationRunService.completeRun(
      user.id,
      parsed.data.runId,
      {
        markOperationVerified: parsed.data.markOperationVerified,
        autoLogLinkedHabit: parsed.data.autoLogLinkedHabit,
        timezone: parsed.data.timezone ?? user.timezone ?? "UTC",
      }
    );
    revalidateOperationRoutes({
      operationId: result.run.operationId,
      runId: result.run.id,
    });
    if (result.habitAutoLogged) {
      revalidatePath("/app/habits");
      revalidatePath("/app/today");
    }
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function abandonOperationRunAction(
  raw: z.input<typeof runIdSchema>
): Promise<ActionResult<OperationRunRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = runIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid run ID.");
    }

    const abandoned = await operationRunService.abandonRun(
      user.id,
      parsed.data.runId
    );
    revalidateOperationRoutes({
      operationId: abandoned.operationId,
      runId: abandoned.id,
    });
    return actionOk(abandoned);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function createBlockedStepTaskAction(
  raw: z.input<typeof createBlockedStepTaskSchema>
): Promise<ActionResult<{ task: TaskRecord; reminder: ReminderRecord | null }>> {
  try {
    const { user } = await requireSession();
    const parsed = createBlockedStepTaskSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid follow-up task request.",
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await operationRunService.createBlockedStepTask(
      user.id,
      parsed.data.runId,
      {
        stepKey: parsed.data.stepKey,
        title: parsed.data.title,
        description: parsed.data.description,
        dueAt: parsed.data.dueAt,
        remindAt: parsed.data.remindAt,
        priority: parsed.data.priority,
        timezone: parsed.data.timezone ?? user.timezone ?? "UTC",
        markStepBlocked: parsed.data.markStepBlocked,
      }
    );
    revalidatePath("/app/inbox");
    revalidatePath("/app/today");
    revalidatePath("/app/upcoming");
    revalidatePath("/app/reminders");
    revalidateOperationRoutes({ runId: parsed.data.runId });
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Private Sharing, Smart Dual Invites, Step Flags & Creator Follows
// ---------------------------------------------------------------------------

export async function inviteOperationQuickPickAction(
  raw: z.input<typeof inviteQuickPickSchema>
): Promise<ActionResult<SendOperationInviteResult>> {
  try {
    const { user } = await requireSession();
    const parsed = inviteQuickPickSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid quick-pick invite.");
    }
    const result = await operationShareService.inviteQuickPickUser(
      user.id,
      parsed.data.operationId,
      {
        targetUserId: parsed.data.targetUserId,
        role: parsed.data.role,
      }
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function inviteOperationByEmailAction(
  raw: z.input<typeof inviteByEmailSchema>
): Promise<ActionResult<SendOperationInviteResult>> {
  try {
    const { user } = await requireSession();
    const parsed = inviteByEmailSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Enter a valid email address."
      );
    }
    const result = await operationShareService.inviteByEmail(
      user.id,
      parsed.data.operationId,
      {
        email: parsed.data.email,
        role: parsed.data.role,
      }
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function acceptInAppOperationInviteAction(
  raw: z.input<typeof invitationIdSchema>
): Promise<ActionResult<{ operationId: string; member: OperationMemberRecord }>> {
  try {
    const { user } = await requireSession();
    const parsed = invitationIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid invitation ID.");
    }
    const result = await operationShareService.acceptInAppInvitation(
      user.id,
      parsed.data.invitationId
    );
    revalidatePath("/app/operations");
    revalidatePath(`/app/operations/${result.operationId}`);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function acceptTokenOperationInviteAction(
  raw: z.input<typeof acceptTokenInviteSchema>
): Promise<ActionResult<{ operationId: string; member: OperationMemberRecord }>> {
  try {
    const { user } = await requireSession();
    const parsed = acceptTokenInviteSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid invitation token.");
    }
    const result = await operationShareService.acceptTokenInvitation(
      user.id,
      parsed.data.token
    );
    revalidatePath("/app/operations");
    revalidatePath(`/app/operations/${result.operationId}`);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function declineOperationInviteAction(
  raw: z.input<typeof invitationIdSchema>
): Promise<ActionResult<{ declined: true }>> {
  try {
    const { user } = await requireSession();
    const parsed = invitationIdSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid invitation ID.");
    }
    await operationShareService.declineInvitation(
      user.id,
      parsed.data.invitationId
    );
    revalidatePath("/app/operations");
    return actionOk({ declined: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function revokeOperationInviteAction(
  raw: z.input<typeof revokeInvitationSchema>
): Promise<ActionResult<{ revoked: true }>> {
  try {
    const { user } = await requireSession();
    const parsed = revokeInvitationSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid revoke request.");
    }
    await operationShareService.revokeInvitation(
      user.id,
      parsed.data.operationId,
      parsed.data.invitationId
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk({ revoked: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateOperationMemberRoleAction(
  raw: z.input<typeof memberMutationSchema>
): Promise<ActionResult<OperationMemberRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = memberMutationSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.role) {
      return actionErr("VALIDATION_ERROR", "Invalid member role update.");
    }
    const updated = await operationShareService.updateMemberRole(
      user.id,
      parsed.data.operationId,
      parsed.data.targetUserId,
      parsed.data.role
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function revokeOperationMemberAction(
  raw: z.input<typeof memberMutationSchema>
): Promise<ActionResult<{ revoked: true }>> {
  try {
    const { user } = await requireSession();
    const parsed = memberMutationSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid revoke member request.");
    }
    await operationShareService.revokeMember(
      user.id,
      parsed.data.operationId,
      parsed.data.targetUserId
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk({ revoked: true });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function flagOperationStepAction(
  raw: z.input<typeof flagStepSchema>
): Promise<ActionResult<OperationStepFlagRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = flagStepSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Please describe the issue."
      );
    }
    const created = await operationFlagService.flagStep(
      user.id,
      parsed.data.operationId,
      {
        stepKey: parsed.data.stepKey,
        versionNumber: parsed.data.versionNumber,
        message: parsed.data.message,
        unlistedToken: parsed.data.unlistedToken,
      }
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function resolveOperationStepFlagAction(
  raw: z.input<typeof resolveFlagSchema>
): Promise<ActionResult<OperationStepFlagRecord>> {
  try {
    const { user } = await requireSession();
    const parsed = resolveFlagSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid flag resolution request.");
    }
    const resolved = await operationFlagService.resolveFlag(
      user.id,
      parsed.data.operationId,
      parsed.data.flagId
    );
    revalidatePath(`/app/operations/${parsed.data.operationId}`);
    return actionOk(resolved);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function toggleFollowCreatorAction(
  raw: z.input<typeof followCreatorSchema>
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  try {
    const { user } = await requireSession();
    const parsed = followCreatorSchema.safeParse(raw);
    if (!parsed.success) {
      return actionErr("VALIDATION_ERROR", "Invalid follow request.");
    }
    const res = parsed.data.follow
      ? await operationSocialService.followCreator(
          user.id,
          parsed.data.targetUserId
        )
      : await operationSocialService.unfollowCreator(
          user.id,
          parsed.data.targetUserId
        );

    if (res.targetHandle) {
      invalidatePublicOperationTags({ ownerHandle: res.targetHandle });
      revalidatePath(`/u/${res.targetHandle}`);
    }
    return actionOk({
      following: res.following,
      followerCount: res.followerCount,
    });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
