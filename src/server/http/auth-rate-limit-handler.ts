import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import {
  buildRateLimitHeaders,
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

export const authHandler = toNextJsHandler(auth);

const RATE_LIMITED_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
];

function extractClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

async function extractEmailIdentifier(request: NextRequest): Promise<string> {
  try {
    const cloned = request.clone();
    const contentType = cloned.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return "anon";
    const body = (await cloned.json()) as { email?: unknown };
    if (typeof body?.email === "string" && body.email.trim()) {
      return body.email.trim().toLowerCase().slice(0, 120);
    }
  } catch {
    // Ignore malformed JSON; Better Auth will validate the payload
  }
  return "anon";
}

function attachPrivateNoStore(response: Response, extra?: Record<string, string>): Response {
  const nextHeaders = new Headers(response.headers);
  nextHeaders.set("Cache-Control", "private, no-store");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      nextHeaders.set(k, v);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

export async function handleAuthGet(request: NextRequest): Promise<Response> {
  const response = await authHandler.GET(request);
  return attachPrivateNoStore(response);
}

export async function handleRateLimitedAuthPost(
  request: NextRequest,
  limiter: RateLimiter = defaultRateLimiter,
  delegate: (req: NextRequest) => Promise<Response> = authHandler.POST
): Promise<Response> {
  const pathname = request.nextUrl.pathname;
  const shouldRateLimit = RATE_LIMITED_AUTH_PATHS.some((suffix) =>
    pathname.endsWith(suffix)
  );

  if (shouldRateLimit) {
    const ip = extractClientIp(request);
    const identifier = await extractEmailIdentifier(request);
    const key = `${ip}:${pathname}:${identifier}`;
    const limitResult = await limiter.limit("auth", key);
    const headers = {
      "Cache-Control": "private, no-store",
      ...buildRateLimitHeaders(limitResult),
    };

    if (!limitResult.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Too many authentication attempts. Please retry in ${limitResult.retryAfterSeconds}s.`,
            retryAfterSeconds: limitResult.retryAfterSeconds,
          },
        },
        { status: 429, headers }
      );
    }

    const response = await delegate(request);
    return attachPrivateNoStore(response, headers);
  }

  const response = await delegate(request);
  return attachPrivateNoStore(response);
}
