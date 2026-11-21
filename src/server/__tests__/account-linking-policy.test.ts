import { describe, expect, it } from "vitest";
import {
  assertCanLinkAccount,
  UnverifiedAccountLinkingError,
  type AccountLinkingLookup,
} from "@/server/auth-policy";

describe("assertCanLinkAccount (unverified credential takeover defense)", () => {
  it("always allows creating credential accounts", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: false, hasCredentialAccount: true };
      },
    };

    await expect(
      assertCanLinkAccount(lookup, { userId: "u1", providerId: "credential" })
    ).resolves.toBeUndefined();
  });

  it("strictly blocks auto-linking Google into an unverified credential account", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: false, hasCredentialAccount: true };
      },
    };

    await expect(
      assertCanLinkAccount(lookup, { userId: "u1", providerId: "google" })
    ).rejects.toBeInstanceOf(UnverifiedAccountLinkingError);
  });

  it("allows linking Google when the existing credential account is verified", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: true, hasCredentialAccount: true };
      },
    };

    await expect(
      assertCanLinkAccount(lookup, { userId: "u1", providerId: "google" })
    ).resolves.toBeUndefined();
  });

  it("allows brand-new Google OAuth sign-ups with no pre-existing credential account", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: true, hasCredentialAccount: false };
      },
    };

    await expect(
      assertCanLinkAccount(lookup, { userId: "u2", providerId: "google" })
    ).resolves.toBeUndefined();
  });

  it("blocks untrusted OAuth providers", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: true, hasCredentialAccount: false };
      },
    };

    await expect(
      assertCanLinkAccount(lookup, { userId: "u1", providerId: "github" })
    ).rejects.toBeInstanceOf(UnverifiedAccountLinkingError);
  });
});
