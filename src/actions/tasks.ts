"use server";

import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ReminderRecord,
  type TaskRecord,
} from "@/server/db/schema";
import { taskService } from "@/server/services/task-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required.").max(280),
  description: z.string().max(10_000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.number().int().positive().nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  remindAt: z.number().int().positive().nullable().optional(),
});

const toggleTaskStatusSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  cancelPendingReminders: z.boolean().optional(),
});

const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, "Task title is required.").max(280).optional(),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.number().int().positive().nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

const reorderTaskSchema = z.object({
  taskId: z.string().min(1),
  prevPosition: z.string().nullable().optional(),
  nextPosition: z.string().nullable().optional(),
});

const deleteTaskSchema = z.object({
  taskId: z.string().min(1),
});

function revalidateWorkspacePaths() {
  // Targeted client freshness is driven by TanStack Query domain invalidation
  // (`useInvalidateWorkspace`); hard reloads read live Turso via `force-dynamic`.
}

export async function createTaskAction(
  input: z.input<typeof createTaskSchema>
): Promise<ActionResult<{ task: TaskRecord; reminder: ReminderRecord | null }>> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your task details.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const created = await taskService.createTask(user.id, {
      ...parsed.data,
      timezone: user.timezone || "UTC",
    });
    revalidateWorkspacePaths();
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function toggleTaskStatusAction(
  input: z.input<typeof toggleTaskStatusSchema>
): Promise<ActionResult<{ task: TaskRecord; cancelledReminderCount: number }>> {
  const parsed = toggleTaskStatusSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid task status update.");
  }

  try {
    const { user } = await requireSession();
    const result = await taskService.toggleTaskStatus(
      user.id,
      parsed.data.taskId,
      parsed.data.status,
      {
        cancelPendingReminders: parsed.data.cancelPendingReminders,
        timezone: user.timezone || "UTC",
      }
    );
    revalidateWorkspacePaths();
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateTaskAction(
  input: z.input<typeof updateTaskSchema>
): Promise<ActionResult<TaskRecord>> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your task changes.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const { taskId, ...patch } = parsed.data;
    const updated = await taskService.updateTask(user.id, taskId, patch, {
      timezone: user.timezone || "UTC",
    });
    revalidateWorkspacePaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function reorderTaskAction(
  input: z.input<typeof reorderTaskSchema>
): Promise<ActionResult<TaskRecord>> {
  const parsed = reorderTaskSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid reorder bounds.");
  }

  try {
    const { user } = await requireSession();
    const updated = await taskService.reorderTask(user.id, parsed.data.taskId, {
      prevPosition: parsed.data.prevPosition,
      nextPosition: parsed.data.nextPosition,
    });
    revalidateWorkspacePaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteTaskAction(
  input: z.input<typeof deleteTaskSchema>
): Promise<ActionResult<{ deletedId: string }>> {
  const parsed = deleteTaskSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid task identifier.");
  }

  try {
    const { user } = await requireSession();
    await taskService.deleteTask(user.id, parsed.data.taskId);
    revalidateWorkspacePaths();
    return actionOk({ deletedId: parsed.data.taskId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
