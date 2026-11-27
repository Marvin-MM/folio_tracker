import { DalError, SecretScanBlockedError } from "@/server/dal/errors";
import type { SecretScanFinding } from "@/server/domain/operations/secret-scanner";

export interface ActionErrorPayload {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  secretFindings?: SecretScanFinding[];
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionErrorPayload };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionErr<T = never>(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
  secretFindings?: SecretScanFinding[]
): ActionResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(secretFindings ? { secretFindings } : {}),
    },
  };
}

export function mapErrorToActionResult<T = never>(
  error: unknown
): ActionResult<T> {
  if (error instanceof SecretScanBlockedError) {
    return actionErr(error.code, error.message, undefined, error.findings);
  }
  if (error instanceof DalError) {
    return actionErr(error.code, error.message);
  }
  return actionErr("INTERNAL_ERROR", "An unexpected error occurred.");
}
