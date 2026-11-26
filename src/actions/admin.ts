"use server";

import { z } from "zod";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "@/actions/types";
import type { SweepExpiredSummary } from "@/server/dal/admin-repository";
import { requireAdmin } from "@/server/dal/auth-guard";
import type { AdminRoleSyncResult } from "@/server/services/admin-role-sync";
import { adminService } from "@/server/services/admin-service";

const targetUserSchema = z.object({
  userId: z.string().trim().min(1, "User ID is required."),
});

const toggleSuspensionSchema = z.object({
  userId: z.string().trim().min(1, "User ID is required."),
  suspended: z.boolean(),
});

export async function adminReconcileOutboxAction(): Promise<
  ActionResult<{ reconciledCount: number }>
> {
  try {
    const { user } = await requireAdmin();
    const result = await adminService.reconcileOutboxNow(user.id);
    // Client freshness is driven by TanStack Query `invalidate(["admin"])` so
    // Next.js 16's client Router Cache stays warm for instant exit navigation.
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function adminSweepExpiredAction(): Promise<
  ActionResult<SweepExpiredSummary>
> {
  try {
    const { user } = await requireAdmin();
    const result = await adminService.sweepExpiredRecordsNow(user.id);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function adminSyncRolesAction(): Promise<
  ActionResult<AdminRoleSyncResult>
> {
  try {
    const { user } = await requireAdmin();
    const result = await adminService.syncAdminRolesNow(user.id);
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function adminRevokeUserSessionsAction(
  input: z.input<typeof targetUserSchema>
): Promise<ActionResult<{ revokedSessions: number; targetEmail: string }>> {
  const parsed = targetUserSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid user."
    );
  }

  try {
    const { user } = await requireAdmin();
    const result = await adminService.revokeUserSessions(
      user.id,
      parsed.data.userId
    );
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function adminToggleUserSuspensionAction(
  input: z.input<typeof toggleSuspensionSchema>
): Promise<
  ActionResult<{
    userId: string;
    email: string;
    isSuspended: boolean;
    revokedSessions: number;
  }>
> {
  const parsed = toggleSuspensionSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid suspension request."
    );
  }

  try {
    const { user } = await requireAdmin();
    const result = await adminService.setUserSuspension(
      user.id,
      parsed.data.userId,
      parsed.data.suspended
    );
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
