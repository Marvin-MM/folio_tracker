import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import {
  isEmailPasswordAuthEnabled,
  isEmailPasswordAuthPath,
} from "@/server/auth-policy";
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
  "/forget-password",
  "/reset-password",
  "/send-verification-email",
  "/change-password",
  "/delete-user",
];

function normalizeAuthPathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function buildAuthMethodDisabledResponse(): Response {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "AUTH_METHOD_DISABLED",
        message:
          "Email and password authentication is disabled in production. Please sign in with Google.",
      },
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}

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

function attachPrivateNoStore(
  response: Response,
  extra?: Record<string, string>
): Response {
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

export async function handleAuthGet(
  request: NextRequest,
  delegate: (req: NextRequest) => Promise<Response> = authHandler.GET,
  emailPasswordEnabled: boolean = isEmailPasswordAuthEnabled()
): Promise<Response> {
  const pathname = normalizeAuthPathname(request.nextUrl.pathname);
  if (!emailPasswordEnabled && isEmailPasswordAuthPath(pathname)) {
    return buildAuthMethodDisabledResponse();
  }

  const response = await delegate(request);
  return attachPrivateNoStore(response);
}

export async function handleRateLimitedAuthPost(
  request: NextRequest,
  limiter: RateLimiter = defaultRateLimiter,
  delegate: (req: NextRequest) => Promise<Response> = authHandler.POST,
  emailPasswordEnabled: boolean = isEmailPasswordAuthEnabled()
): Promise<Response> {
  const pathname = normalizeAuthPathname(request.nextUrl.pathname);

  if (!emailPasswordEnabled && isEmailPasswordAuthPath(pathname)) {
    return buildAuthMethodDisabledResponse();
  }

  const shouldRateLimit = RATE_LIMITED_AUTH_PATHS.some((suffix) =>
    pathname.endsWith(suffix)
  );

  if (shouldRateLimit) {
    const ip = extractClientIp(request);
    const identifier = await extractEmailIdentifier(request);
    const ipBucket = await limiter.limit("auth", `ip:${ip}:${pathname}`);
    let effectiveLimit = ipBucket;

    if (ipBucket.allowed && identifier !== "anon") {
      const emailBucket = await limiter.limit(
        "auth",
        `email:${pathname}:${identifier}`
      );
      if (!emailBucket.allowed || emailBucket.remaining < ipBucket.remaining) {
        effectiveLimit = emailBucket;
      }
    }

    const headers = {
      "Cache-Control": "private, no-store",
      ...buildRateLimitHeaders(effectiveLimit),
    };

    if (!effectiveLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Too many authentication attempts. Please retry in ${effectiveLimit.retryAfterSeconds}s.`,
            retryAfterSeconds: effectiveLimit.retryAfterSeconds,
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
