import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { APP_NAME } from "@/lib/constants";
import { isAdminEmail } from "./admin-policy";
import {
  assertCanLinkAccount,
  isEmailPasswordAuthEnabled,
  TRUSTED_OAUTH_PROVIDERS,
  UnverifiedAccountLinkingError,
  type AccountLinkingLookup,
} from "./auth-policy";
import { db } from "./db";
import * as schema from "./db/schema";
import { createAuthEmailDispatcher } from "./providers/auth-email-dispatcher";

const authEmailDispatcher = createAuthEmailDispatcher();

const drizzleAccountLinkingLookup: AccountLinkingLookup = {
  async findUserAndCredentialAccount(userId: string) {
    const [userRow] = await db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!userRow) {
      return null;
    }

    const [credentialAccount] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          eq(schema.accounts.providerId, "credential")
        )
      )
      .limit(1);

    return {
      emailVerified: userRow.emailVerified,
      hasCredentialAccount: Boolean(credentialAccount),
    };
  },
};

export { isEmailPasswordAuthEnabled };

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const isProduction = process.env.NODE_ENV === "production";
const emailPasswordEnabled = isEmailPasswordAuthEnabled();

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    usePlural: true,
  }),
  user: {
    additionalFields: {
      timezone: {
        type: "string",
        required: false,
        defaultValue: "UTC",
        input: true,
      },
      emailRemindersEnabled: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: true,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
      isSuspended: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: emailPasswordEnabled,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      // Avoid awaiting remote SMTP/API inline where timing could leak account existence
      void authEmailDispatcher
        .sendPasswordResetEmail({
          to: user.email,
          recipientName: user.name,
          resetUrl: url,
        })
        .catch((error: unknown) => {
          console.error(
            "AuthEmailDispatcher password reset error:",
            error instanceof Error ? error.message : "Unknown error"
          );
        });
    },
  },
  emailVerification: {
    sendOnSignUp: emailPasswordEnabled,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      void authEmailDispatcher
        .sendVerificationEmail({
          to: user.email,
          recipientName: user.name,
          verificationUrl: url,
        })
        .catch((error: unknown) => {
          console.error(
            "AuthEmailDispatcher verification error:",
            error instanceof Error ? error.message : "Unknown error"
          );
        });
    },
  },
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {},
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [...TRUSTED_OAUTH_PROVIDERS],
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 300, // 5-minute signed cookie cache
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const shouldPromote =
            Boolean(user.emailVerified) && isAdminEmail(user.email);
          return {
            data: {
              ...user,
              role: shouldPromote ? "admin" : "user",
              isSuspended: false,
            },
          };
        },
      },
      update: {
        before: async (user) => {
          if (user.emailVerified === true && typeof user.email === "string") {
            return {
              data: {
                ...user,
                role: isAdminEmail(user.email) ? "admin" : "user",
              },
            };
          }
          return { data: user };
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          try {
            await assertCanLinkAccount(
              drizzleAccountLinkingLookup,
              {
                userId: account.userId,
                providerId: account.providerId,
              },
              { emailPasswordEnabled }
            );
          } catch (error) {
            if (error instanceof UnverifiedAccountLinkingError) {
              throw new APIError("FORBIDDEN", {
                message:
                  "Unable to sign in with this provider. Please verify your email address first.",
              });
            }
            throw error;
          }
        },
      },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
    database: {
      generateId: () => ulid(),
    },
  },
  plugins: [nextCookies()],
});

export type BetterAuthSession = typeof auth.$Infer.Session;
