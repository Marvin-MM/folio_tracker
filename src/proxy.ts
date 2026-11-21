import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeCallbackUrl } from "@/lib/redirect";

/**
 * Next.js 16 optimistic network-boundary redirect proxy.
 *
 * SECURITY NOTE: This proxy checks only for the presence of a Better Auth
 * session cookie for fast UX redirects on `/app/*`. It is NEVER the sole
 * security boundary — every `/app/*` layout/page, Route Handler, and Server
 * Action independently enforces `requireSession()` inside the DAL.
 *
 * Auth entry routes (`/login`, `/register`) intentionally validate sessions
 * server-side via `getOptionalSession()` rather than bouncing purely on cookie
 * presence, preventing stale/revoked cookies from creating a redirect loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!sessionCookie) {
      const loginUrl = new URL("/login", request.url);
      const safeTarget = sanitizeCallbackUrl(`${pathname}${search}`);
      loginUrl.searchParams.set("callbackURL", safeTarget);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
