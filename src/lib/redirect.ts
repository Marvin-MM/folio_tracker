import { DEFAULT_AUTHENTICATED_PATH } from "./constants";

const AUTH_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

/**
 * Strictly sanitizes a `callbackURL` parameter to defend against open-redirect
 * attacks. Only allows same-origin relative paths beginning with a single `/`.
 */
export function sanitizeCallbackUrl(
  rawUrl: string | null | undefined,
  fallback: string = DEFAULT_AUTHENTICATED_PATH
): string {
  if (typeof rawUrl !== "string") {
    return fallback;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed || !trimmed.startsWith("/")) {
    return fallback;
  }

  // Reject protocol-relative (`//evil.com`), backslash (`/\evil.com`), or control chars
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    return fallback;
  }

  // Reject encoded leading slash/backslash smuggling (e.g., `/%2f`, `/%5c`)
  if (/^\/%(?:2f|5c)/i.test(trimmed)) {
    return fallback;
  }

  // Parse against a fixed dummy origin to guarantee same-origin resolution
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://folio.invalid");
  } catch {
    return fallback;
  }

  if (parsed.origin !== "https://folio.invalid") {
    return fallback;
  }

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  // Avoid redirecting back into an auth page loop
  if (
    AUTH_ROUTE_PREFIXES.some(
      (prefix) =>
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    )
  ) {
    return fallback;
  }

  return normalized;
}
