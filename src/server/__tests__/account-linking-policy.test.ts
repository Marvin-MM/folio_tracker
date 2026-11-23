import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  assertCanLinkAccount,
  EMAIL_PASSWORD_AUTH_PATH_SUFFIXES,
  isEmailPasswordAuthEnabled,
  isEmailPasswordAuthPath,
  UnverifiedAccountLinkingError,
  type AccountLinkingLookup,
} from "@/server/auth-policy";
import {
  handleAuthGet,
  handleRateLimitedAuthPost,
} from "@/server/http/auth-rate-limit-handler";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";

describe("isEmailPasswordAuthEnabled & path matching (Google-only in production)", () => {
  it("enables email/password in development and test, and disables it in production", () => {
    expect(isEmailPasswordAuthEnabled("development")).toBe(true);
    expect(isEmailPasswordAuthEnabled("test")).toBe(true);
    expect(isEmailPasswordAuthEnabled(undefined)).toBe(true);
    expect(isEmailPasswordAuthEnabled("production")).toBe(false);
  });

  it("identifies all credential auth endpoints while allowing Google OAuth and session routes", () => {
    for (const suffix of EMAIL_PASSWORD_AUTH_PATH_SUFFIXES) {
      expect(isEmailPasswordAuthPath(`/api/auth${suffix}`)).toBe(true);
      expect(isEmailPasswordAuthPath(`/api/auth${suffix}/`)).toBe(true);
    }

    expect(isEmailPasswordAuthPath("/api/auth/sign-in/social")).toBe(false);
    expect(isEmailPasswordAuthPath("/api/auth/callback/google")).toBe(false);
    expect(isEmailPasswordAuthPath("/api/auth/get-session")).toBe(false);
    expect(isEmailPasswordAuthPath("/api/auth/sign-out")).toBe(false);
  });
});

describe("HTTP auth boundary enforcement when email/password is disabled", () => {
  it("blocks credential POST/GET endpoints with 403 AUTH_METHOD_DISABLED and private, no-store", async () => {
    const limiter = new InMemoryRateLimiter();
    const delegate = vi.fn(async () => new Response("ok", { status: 200 }));

    const postReq = new NextRequest(
      "https://folio.renult.xyz/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      }
    );

    const postRes = await handleRateLimitedAuthPost(
      postReq,
      limiter,
      delegate,
      false
    );
    expect(postRes.status).toBe(403);
    expect(postRes.headers.get("cache-control")).toBe("private, no-store");
    expect(await postRes.json()).toEqual({
      ok: false,
      error: {
        code: "AUTH_METHOD_DISABLED",
        message:
          "Email and password authentication is disabled in production. Please sign in with Google.",
      },
    });
    expect(delegate).not.toHaveBeenCalled();

    const getVerifyReq = new NextRequest(
      "https://folio.renult.xyz/api/auth/verify-email?token=abc"
    );
    const getRes = await handleAuthGet(getVerifyReq, delegate, false);
    expect(getRes.status).toBe(403);
    expect(getRes.headers.get("cache-control")).toBe("private, no-store");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("permits Google OAuth and session endpoints when email/password is disabled", async () => {
    const limiter = new InMemoryRateLimiter();
    const delegate = vi.fn(
      async () =>
        new Response(JSON.stringify({ redirect: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );

    const socialReq = new NextRequest(
      "https://folio.renult.xyz/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: "/app/today" }),
      }
    );

    const socialRes = await handleRateLimitedAuthPost(
      socialReq,
      limiter,
      delegate,
      false
    );
    expect(socialRes.status).toBe(200);
    expect(socialRes.headers.get("cache-control")).toBe("private, no-store");
    expect(delegate).toHaveBeenCalledTimes(1);

    const callbackReq = new NextRequest(
      "https://folio.renult.xyz/api/auth/callback/google?code=123&state=xyz"
    );
    const callbackRes = await handleAuthGet(callbackReq, delegate, false);
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.headers.get("cache-control")).toBe("private, no-store");
    expect(delegate).toHaveBeenCalledTimes(2);
  });
});

describe("assertCanLinkAccount (unverified credential takeover defense)", () => {
  it("allows creating credential accounts when email/password auth is enabled (dev/test)", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return { emailVerified: false, hasCredentialAccount: true };
      },
    };

    await expect(
      assertCanLinkAccount(
        lookup,
        { userId: "u1", providerId: "credential" },
        { emailPasswordEnabled: true }
      )
    ).resolves.toBeUndefined();
  });

  it("blocks creating credential accounts when email/password auth is disabled (production)", async () => {
    const lookup: AccountLinkingLookup = {
      async findUserAndCredentialAccount() {
        return null;
      },
    };

    await expect(
      assertCanLinkAccount(
        lookup,
        { userId: "u1", providerId: "credential" },
        { emailPasswordEnabled: false }
      )
    ).rejects.toBeInstanceOf(UnverifiedAccountLinkingError);
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
      assertCanLinkAccount(
        lookup,
        { userId: "u2", providerId: "google" },
        { emailPasswordEnabled: false }
      )
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
