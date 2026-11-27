"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import { invalidatePublicOperationTags } from "@/server/dal/public-operations-cache";
import type { UserPreferencesRecord } from "@/server/dal/user-repository";
import { MAX_USER_BIO_LENGTH } from "@/server/domain/operations";
import { userPreferencesService } from "@/server/services/user-preferences-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const syncTimezoneSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
});

const updatePreferencesSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  timezone: z.string().trim().min(1, "Timezone is required.").max(100),
  emailRemindersEnabled: z.boolean(),
  handle: z.string().trim().max(32).nullish(),
  bio: z.string().trim().max(MAX_USER_BIO_LENGTH).nullish(),
});

export async function syncUserTimezoneAction(
  input: z.input<typeof syncTimezoneSchema>
): Promise<ActionResult<UserPreferencesRecord>> {
  const parsed = syncTimezoneSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Invalid timezone value.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    if (user.timezone === parsed.data.timezone) {
      return actionOk({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role === "admin" ? "admin" : "user",
        isSuspended: Boolean(user.isSuspended),
        timezone: user.timezone ?? "UTC",
        emailRemindersEnabled: user.emailRemindersEnabled ?? true,
        handle: typeof user.handle === "string" ? user.handle : null,
        bio: typeof user.bio === "string" ? user.bio : null,
      });
    }

    const updated = await userPreferencesService.syncTimezone(
      user.id,
      parsed.data.timezone
    );
    revalidatePath("/app", "layout");
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateUserPreferencesAction(
  input: z.input<typeof updatePreferencesSchema>
): Promise<ActionResult<UserPreferencesRecord>> {
  const parsed = updatePreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check the highlighted fields.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const previousHandle =
      typeof user.handle === "string" ? user.handle : null;
    const updated = await userPreferencesService.updatePreferences(
      user.id,
      parsed.data
    );
    invalidatePublicOperationTags({
      ownerHandle: updated.handle,
      previousHandle,
    });
    revalidatePath("/app", "layout");
    revalidatePath("/app/settings");
    if (updated.handle) revalidatePath(`/u/${updated.handle}`);
    if (previousHandle && previousHandle !== updated.handle) {
      revalidatePath(`/u/${previousHandle}`);
    }
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
