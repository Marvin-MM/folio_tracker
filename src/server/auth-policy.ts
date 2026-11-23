export const TRUSTED_OAUTH_PROVIDERS = ["google"] as const;
export type TrustedOAuthProvider = (typeof TRUSTED_OAUTH_PROVIDERS)[number];

/**
 * Credential-based Better Auth endpoints that are disabled in production
 * (where Folio enforces Google OAuth exclusively).
 */
export const EMAIL_PASSWORD_AUTH_PATH_SUFFIXES = [
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/forget-password",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/change-password",
  "/set-password",
] as const;

/**
 * Email/password authentication is available in local development and tests
 * (`NODE_ENV !== "production"`), while production uses Google OAuth exclusively.
 */
export function isEmailPasswordAuthEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return nodeEnv !== "production";
}

export function isEmailPasswordAuthPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  return EMAIL_PASSWORD_AUTH_PATH_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix)
  );
}

export interface AccountLinkingLookup {
  findUserAndCredentialAccount(userId: string): Promise<{
    emailVerified: boolean;
    hasCredentialAccount: boolean;
  } | null>;
}

export class UnverifiedAccountLinkingError extends Error {
  readonly code = "UNVERIFIED_CREDENTIAL_ACCOUNT_LINK_BLOCKED";

  constructor(
    message = "Unable to link provider to an unverified email/password account."
  ) {
    super(message);
    this.name = "UnverifiedAccountLinkingError";
  }
}

/**
 * Defense-in-depth policy invoked before Better Auth inserts a new row into `accounts`.
 *
 * Strictly enforces:
 * 1. Credential (`email/password`) account creation is blocked in production.
 * 2. Non-credential linking is ONLY permitted for explicitly trusted providers (`google`).
 * 3. Auto-linking a social provider into an existing user who has an unverified
 *    email/password (`credential`) account is ALWAYS rejected to prevent pre-registration
 *    account takeover attacks.
 */
export async function assertCanLinkAccount(
  lookup: AccountLinkingLookup,
  input: { userId: string; providerId: string },
  options?: { emailPasswordEnabled?: boolean }
): Promise<void> {
  const emailPasswordEnabled =
    options?.emailPasswordEnabled ?? isEmailPasswordAuthEnabled();

  if (input.providerId === "credential") {
    if (!emailPasswordEnabled) {
      throw new UnverifiedAccountLinkingError(
        "Email and password accounts are disabled in production."
      );
    }
    return;
  }

  const isTrustedProvider = (
    TRUSTED_OAUTH_PROVIDERS as readonly string[]
  ).includes(input.providerId);

  if (!isTrustedProvider) {
    throw new UnverifiedAccountLinkingError(
      `Account linking is not permitted for provider "${input.providerId}".`
    );
  }

  const existing = await lookup.findUserAndCredentialAccount(input.userId);
  if (!existing) {
    return;
  }

  if (existing.hasCredentialAccount && !existing.emailVerified) {
    throw new UnverifiedAccountLinkingError();
  }
}
