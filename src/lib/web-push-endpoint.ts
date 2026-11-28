const ALLOWED_PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  ".push.services.mozilla.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  ".push.apple.com",
  ".notify.windows.com",
  ".push.samsungosp.com",
] as const;

/**
 * Validates that a Web Push subscription endpoint targets a trusted HTTPS push
 * service and cannot be abused for SSRF against internal or non-push hosts.
 */
export function isAllowedWebPushEndpoint(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    // Reject IP literals, localhost, and non-public hosts (anti-SSRF)
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(":")
    ) {
      return false;
    }
    return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) =>
      suffix.startsWith(".")
        ? host.endsWith(suffix) && host.length > suffix.length
        : host === suffix
    );
  } catch {
    return false;
  }
}
