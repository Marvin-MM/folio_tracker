export const TRUSTED_OAUTH_PROVIDERS = ["google"] as const;
export type TrustedOAuthProvider = (typeof TRUSTED_OAUTH_PROVIDERS)[number];

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
 * 1. Non-credential linking is ONLY permitted for explicitly trusted providers (`google`).
 * 2. Auto-linking a social provider into an existing user who has an unverified
 *    email/password (`credential`) account is ALWAYS rejected to prevent pre-registration
 *    account takeover attacks.
 */
export async function assertCanLinkAccount(
  lookup: AccountLinkingLookup,
  input: { userId: string; providerId: string }
): Promise<void> {
  if (input.providerId === "credential") {
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
