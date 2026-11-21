import { DalError } from "@/server/dal/errors";

export interface ActionErrorPayload {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
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
  fieldErrors?: Record<string, string[]>
): ActionResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
}

export function mapErrorToActionResult<T = never>(
  error: unknown
): ActionResult<T> {
  if (error instanceof DalError) {
    return actionErr(error.code, error.message);
  }
  return actionErr("INTERNAL_ERROR", "An unexpected error occurred.");
}
