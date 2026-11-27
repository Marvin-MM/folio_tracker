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
import {
  TASK_PRIORITIES,
  type OperationRecord,
  type OperationRunRecord,
  type OperationRunStepRecord,
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
  operationRunService,
  type CompleteRunResult,
  type OperationRunDetailPayload,
} from "@/server/services/operation-run-service";
import {
  operationService,
  type OperationMutationResult,
} from "@/server/services/operation-service";

const blueprintBaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(MAX_OPERATION_TITLE_LENGTH),
  summary: z.string().trim().max(MAX_OPERATION_SUMMARY_LENGTH).optional(),
  domain: operationDomainSchema.default("general"),
  tags: operationTagsSchema.optional(),
  difficulty: operationDifficultySchema.nullish(),
  estimatedMinutes: z.number().int().min(1).max(10080).nullish(),
  visibility: operationVisibilitySchema.default("private"),
  allowForking: z.boolean().optional(),
  reviewCycleDays: z.number().int().min(1).max(3650).nullish(),
  projectId: z.string().trim().min(1).nullish(),
  linkedHabitId: z.string().trim().min(1).nullish(),
  referenceNoteIds: z.array(z.string().trim().min(1)).max(MAX_REFERENCE_NOTES).optional(),
  variables: operationVariablesSchemaArray.optional(),
  prerequisites: operationPrerequisitesSchemaArray.optional(),
  steps: operationStepsSchemaArray,
  changeSummary: z.string().trim().max(240).nullish(),
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
  prerequisitesChecked: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

const updateRunPreflightSchema = z.object({
  runId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  variablesValues: z.record(z.string(), z.string().max(1000)).optional(),
  prerequisitesChecked: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
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

function revalidateOperationRoutes(operationId?: string, runId?: string) {
  revalidatePath("/app/operations");
  if (operationId) {
    revalidatePath(`/app/operations/${operationId}`);
    revalidatePath(`/app/operations/${operationId}/edit`);
  }
  if (runId) {
    revalidatePath(`/app/operations/runs/${runId}`);
  }
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
    revalidateOperationRoutes(result.operation.id);
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
    revalidateOperationRoutes(operationId);
    return actionOk(result);
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
      }
    );
    revalidateOperationRoutes(parsed.data.operationId);
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
    const updated = await operationService.archiveOperation(
      user.id,
      parsed.data.operationId,
      parsed.data.isArchived
    );
    revalidateOperationRoutes(parsed.data.operationId);
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
    await operationService.deleteOperation(user.id, parsed.data.operationId);
    revalidateOperationRoutes(parsed.data.operationId);
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
    const updated = await operationService.markVerified(
      user.id,
      parsed.data.operationId
    );
    revalidateOperationRoutes(parsed.data.operationId);
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
      }
    );
    revalidateOperationRoutes(parsed.data.operationId, detail.run.id);
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
    revalidateOperationRoutes(detail.operation.id, detail.run.id);
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
    revalidateOperationRoutes(result.run.operationId, result.run.id);
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
    revalidateOperationRoutes(abandoned.operationId, abandoned.id);
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
    revalidateOperationRoutes(undefined, parsed.data.runId);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
