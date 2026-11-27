export const PUBLIC_HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{2,29}$/;
export const MAX_USER_BIO_LENGTH = 200;

export const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "explore",
  "folio",
  "forgot-password",
  "help",
  "invite",
  "login",
  "logout",
  "me",
  "offline",
  "ops",
  "operations",
  "privacy",
  "profile",
  "register",
  "reset-password",
  "robots",
  "settings",
  "signup",
  "sitemap",
  "support",
  "system",
  "terms",
  "u",
  "user",
  "users",
  "verify-email",
]);

export function normalizePublicHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

export function validatePublicHandle(
  raw: string
): { ok: true; handle: string } | { ok: false; message: string } {
  const handle = normalizePublicHandle(raw);
  if (!handle) {
    return { ok: false, message: "Handle cannot be empty." };
  }
  if (!PUBLIC_HANDLE_REGEX.test(handle)) {
    return {
      ok: false,
      message:
        "Handle must be 3–30 characters using lowercase letters, numbers, hyphens, or underscores.",
    };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return {
      ok: false,
      message: `The handle "@${handle}" is reserved.`,
    };
  }
  return { ok: true, handle };
}
