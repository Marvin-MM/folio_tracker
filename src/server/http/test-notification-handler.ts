import { NextResponse } from "next/server";
import { requireSession } from "@/server/dal/auth-guard";
import { DalError } from "@/server/dal/errors";
import {
  buildRateLimitHeaders,
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";
import { notificationService } from "@/server/services/notification-service";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

export async function handleTestNotificationPost(
  limiter: RateLimiter = defaultRateLimiter
): Promise<Response> {
  try {
    const { user } = await requireSession();
    const limitResult = await limiter.limit("test_push", user.id);
    const rateHeaders = {
      ...NO_STORE_HEADERS,
      ...buildRateLimitHeaders(limitResult),
    };

    if (!limitResult.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Test notification rate limit exceeded. Retry in ${limitResult.retryAfterSeconds}s.`,
            retryAfterSeconds: limitResult.retryAfterSeconds,
          },
        },
        { status: 429, headers: rateHeaders }
      );
    }

    const results = await notificationService.sendTestReminder(
      user.id,
      user.timezone || "UTC"
    );
    return NextResponse.json(
      { ok: true, data: { results } },
      { status: 200, headers: rateHeaders }
    );
  } catch (error) {
    if (error instanceof DalError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.statusCode, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to dispatch test reminder.",
        },
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
