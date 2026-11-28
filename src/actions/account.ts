"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import { invalidatePublicOperationTags } from "@/server/dal/public-operations-cache";
import {
  accountService,
  type DeleteAccountResult,
} from "@/server/services/account-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const deleteAccountSchema = z.object({
  confirmEmail: z.string().email(),
});

export async function deleteAccountAction(
  input: z.input<typeof deleteAccountSchema>
): Promise<ActionResult<DeleteAccountResult>> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please enter your account email address to confirm deletion."
    );
  }

  try {
    const { user } = await requireSession();
    if (
      parsed.data.confirmEmail.trim().toLowerCase() !==
      user.email.trim().toLowerCase()
    ) {
      return actionErr(
        "VALIDATION_ERROR",
        "The confirmation email does not match your signed-in account."
      );
    }

    const result = await accountService.deleteAccount(user.id);
    invalidatePublicOperationTags({
      ownerHandle: result.deletedHandle,
      extraSlugs: result.deletedPublicSlugs,
      affectsExplore: (result.deletedPublicSlugs?.length ?? 0) > 0,
    });
    revalidatePath("/", "layout");
    return actionOk(result);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
