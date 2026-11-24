/**
 * Pure, zero-I/O env policy helper for platform administrator allowlisting.
 *
 * Configure `ADMIN_EMAILS` as a comma-separated (or semicolon/newline-separated)
 * list of verified user emails, e.g.:
 *   ADMIN_EMAILS="alice@example.com, bob@example.com"
 *
 * SECURITY INVARIANT:
 * - Fail-closed when `ADMIN_EMAILS` is blank or unset (returns empty list).
 * - All emails are normalized lowercase & trimmed before comparison.
 */

const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAdminEmails(
  rawEnv: string | undefined = process.env.ADMIN_EMAILS
): string[] {
  if (!rawEnv) return [];

  const seen = new Set<string>();
  const parts = rawEnv.split(/[,;\n]+/);

  for (const part of parts) {
    const normalized = part.trim().toLowerCase();
    if (!normalized) continue;
    if (!BASIC_EMAIL_REGEX.test(normalized)) continue;
    seen.add(normalized);
  }

  return Array.from(seen).sort();
}

export function getConfiguredAdminEmails(): string[] {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

export function getAdminEmailsFingerprint(
  rawEnv: string | undefined = process.env.ADMIN_EMAILS
): string {
  return parseAdminEmails(rawEnv).join(",");
}

export function isAdminEmail(
  email: string | null | undefined,
  rawEnv: string | undefined = process.env.ADMIN_EMAILS
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const allowed = parseAdminEmails(rawEnv);
  return allowed.includes(normalized);
}
