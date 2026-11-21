import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeCallbackUrl } from "@/lib/redirect";

/**
 * Next.js 16 optimistic network-boundary redirect & cache-isolation proxy.
 *
 * SECURITY NOTE: This proxy checks only for the presence of a Better Auth
 * session cookie for fast UX redirects on `/app/*`. It is NEVER the sole
 * security boundary — every `/app/*` layout/page, Route Handler, and Server
 * Action independently enforces `requireSession()` inside the DAL.
 *
 * Also enforces `Cache-Control: private, no-store` on `/app/*` and `/invite/*`
 * so CDN/edge proxies can never cache authenticated views or invite tokens.
 *
 * Auth entry routes (`/login`, `/register`) intentionally validate sessions
 * server-side via `getOptionalSession()` rather than bouncing purely on cookie
 * presence, preventing stale/revoked cookies from creating a redirect loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/app" || pathname.startsWith("/app/")) {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      const loginUrl = new URL("/login", request.url);
      const safeTarget = sanitizeCallbackUrl(`${pathname}${search}`);
      loginUrl.searchParams.set("callbackURL", safeTarget);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.headers.set("Cache-Control", "private, no-store");
      return redirectResponse;
    }

    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (pathname.startsWith("/invite/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app", "/app/:path*", "/invite/:path*"],
};
