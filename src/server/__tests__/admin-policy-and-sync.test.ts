import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAdminEmail, parseAdminEmails } from "@/server/admin-policy";
import {
  requireAdmin,
  resolveLiveAdminStatus,
  type SessionResolver,
} from "@/server/dal/auth-guard";
import { ForbiddenError } from "@/server/dal/errors";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { adminAuditLogs, users } from "@/server/db/schema";
import { syncAdminRolesFromEnv } from "@/server/services/admin-role-sync";

function makeSessionResolver(user: {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role?: "user" | "admin";
  isSuspended?: boolean;
}): SessionResolver {
  return {
    async getSession() {
      return {
        session: {
          id: "sess-1",
          userId: user.id,
          token: "tok-1",
          expiresAt: new Date(Date.now() + 3600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        },
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          image: null,
          timezone: "UTC",
          emailRemindersEnabled: true,
          role: user.role ?? "user",
          isSuspended: user.isSuspended ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    },
  };
}

describe("ADMIN_EMAILS policy parsing & automatic role promotion/demotion", () => {
  let tempDir: string;
  let conn: DbConnection;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-admin-sync-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;
    conn = createDbConnection({ url: dbUrl });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
  });

  afterAll(async () => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses comma/semicolon/newline ADMIN_EMAILS cleanly and fails closed when empty", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("   ")).toEqual([]);
    expect(
      parseAdminEmails(
        " Alice@Example.com, bob@example.com ; ALICE@example.com \n not-an-email , carol@folio.xyz "
      )
    ).toEqual(["alice@example.com", "bob@example.com", "carol@folio.xyz"]);

    expect(isAdminEmail("ALICE@example.com", "alice@example.com")).toBe(true);
    expect(isAdminEmail("mallory@example.com", "alice@example.com")).toBe(false);
    expect(isAdminEmail("alice@example.com", "")).toBe(false);
  });

  it("promotes verified env-listed users, ignores unverified accounts, and demotes removed admins automatically", async () => {
    const now = new Date();
    await conn.db.insert(users).values([
      {
        id: "u-alice",
        name: "Alice Admin",
        email: "alice@folio.test",
        emailVerified: true,
        role: "user",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-bob",
        name: "Bob Admin",
        email: "bob@folio.test",
        emailVerified: true,
        role: "user",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-unverified",
        name: "Unverified Claimer",
        email: "unverified@folio.test",
        emailVerified: false,
        role: "user",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-regular",
        name: "Regular Member",
        email: "member@folio.test",
        emailVerified: true,
        role: "user",
        isSuspended: false,
        timezone: "UTC",
        emailRemindersEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 1. Promote Alice & Bob; Unverified email must NOT be promoted
    const first = await syncAdminRolesFromEnv(
      conn.db,
      "alice@folio.test, bob@folio.test, unverified@folio.test"
    );
    expect(first.promotedEmails.sort()).toEqual([
      "alice@folio.test",
      "bob@folio.test",
    ]);
    expect(first.demotedEmails).toEqual([]);
    expect(first.activeAdminCount).toBe(2);

    const [unverifiedRow] = await conn.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, "u-unverified"));
    expect(unverifiedRow?.role).toBe("user");

    // Audit row written once for real transition
    const logsAfterFirst = await conn.db.select().from(adminAuditLogs);
    expect(logsAfterFirst.length).toBe(1);

    // 2. Idempotent re-run produces zero changes and zero extra audit noise
    const noop = await syncAdminRolesFromEnv(
      conn.db,
      "alice@folio.test, bob@folio.test, unverified@folio.test"
    );
    expect(noop.promotedEmails).toEqual([]);
    expect(noop.demotedEmails).toEqual([]);
    const logsAfterNoop = await conn.db.select().from(adminAuditLogs);
    expect(logsAfterNoop.length).toBe(1);

    // 3. Remove Bob from ADMIN_EMAILS -> automatically demoted
    const second = await syncAdminRolesFromEnv(conn.db, "alice@folio.test");
    expect(second.promotedEmails).toEqual([]);
    expect(second.demotedEmails).toEqual(["bob@folio.test"]);
    expect(second.activeAdminCount).toBe(1);

    const [bobAfterDemote] = await conn.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, "u-bob"));
    expect(bobAfterDemote?.role).toBe("user");

    // 4. Empty ADMIN_EMAILS -> fail-closed demotes all remaining admins
    const cleared = await syncAdminRolesFromEnv(conn.db, "");
    expect(cleared.demotedEmails).toEqual(["alice@folio.test"]);
    expect(cleared.activeAdminCount).toBe(0);
  });

  it("requireAdmin enforces live Turso + ADMIN_EMAILS parity and demotes stale DB admins on request", async () => {
    // Re-promote Alice in DB, then call requireAdmin with empty env -> instant demote + ForbiddenError
    await conn.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, "u-alice"));

    await expect(
      requireAdmin(
        makeSessionResolver({
          id: "u-alice",
          email: "alice@folio.test",
          name: "Alice Admin",
          emailVerified: true,
          role: "admin",
        }),
        conn.db,
        ""
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    const [aliceRow] = await conn.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, "u-alice"));
    expect(aliceRow?.role).toBe("user");

    // Calling resolveLiveAdminStatus when Alice IS in ADMIN_EMAILS auto-promotes & allows
    const promotedLive = await resolveLiveAdminStatus(
      "u-alice",
      conn.db,
      "alice@folio.test"
    );
    expect(promotedLive.isAdmin).toBe(true);

    const ctx = await requireAdmin(
      makeSessionResolver({
        id: "u-alice",
        email: "alice@folio.test",
        name: "Alice Admin",
        emailVerified: true,
      }),
      conn.db,
      "alice@folio.test"
    );
    expect(ctx.user.id).toBe("u-alice");
  });
});
