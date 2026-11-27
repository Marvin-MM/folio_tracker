import { NextResponse } from "next/server";
import { requireSession, type AuthenticatedContext } from "@/server/dal/auth-guard";
import {
  CommentWindowClosedError,
  ConcurrencyConflictError,
  ConflictError,
  ForbiddenError,
  MonthLockedError,
  NotFoundError,
  RateLimitError,
  SecretScanBlockedError,
  UnauthorizedError,
  ValidationError,
} from "@/server/dal/errors";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

export function workspaceJson<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function workspaceErrorJson(
  code: string,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message },
    },
    {
      status,
      headers: PRIVATE_NO_STORE_HEADERS,
    }
  );
}

/**
 * Shared security wrapper for all `GET /api/workspace/*` read endpoints:
 * - Enforces live Better Auth session directly via `requireSession()`.
 * - Always sends `Cache-Control: private, no-store` so CDN/edge proxies never cache tenant data.
 * - Maps domain/DAL errors to clean HTTP status codes without leaking stack traces.
 */
export async function withWorkspaceAuth(
  handler: (auth: AuthenticatedContext) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const auth = await requireSession();
    return await handler(auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return workspaceErrorJson(error.code, error.message, 401);
    }
    if (error instanceof CommentWindowClosedError) {
      return workspaceErrorJson(error.code, error.message, 403);
    }
    if (error instanceof MonthLockedError) {
      return workspaceErrorJson(error.code, error.message, 403);
    }
    if (error instanceof ForbiddenError) {
      return workspaceErrorJson(error.code, error.message, 403);
    }
    if (error instanceof NotFoundError) {
      return workspaceErrorJson(error.code, error.message, 404);
    }
    if (error instanceof ConcurrencyConflictError) {
      return workspaceErrorJson(error.code, error.message, 409);
    }
    if (error instanceof SecretScanBlockedError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            findings: error.findings,
          },
        },
        { status: 422, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    if (error instanceof ConflictError) {
      return workspaceErrorJson(error.code, error.message, 409);
    }
    if (error instanceof RateLimitError) {
      return workspaceErrorJson(error.code, error.message, 429);
    }
    if (error instanceof ValidationError) {
      return workspaceErrorJson(error.code, error.message, 400);
    }

    console.error(
      "Workspace read API error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return workspaceErrorJson(
      "INTERNAL_ERROR",
      "Unable to load workspace data.",
      500
    );
  }
}
