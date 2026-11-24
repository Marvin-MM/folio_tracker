import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  getAdminEmailsFingerprint,
  parseAdminEmails,
} from "@/server/admin-policy";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import { adminAuditLogs, users } from "@/server/db/schema";

export interface AdminRoleSyncResult {
  configuredEmails: string[];
  promotedEmails: string[];
  demotedEmails: string[];
  activeAdminCount: number;
}

const globalForAdminSync = globalThis as unknown as {
  __folioAdminSyncFingerprint?: string;
  __folioAdminSyncPromise?: Promise<AdminRoleSyncResult>;
};

/**
 * Atomically reconciles `users.role` against the `ADMIN_EMAILS` environment list:
 * - Promotes any VERIFIED user whose email is listed in `ADMIN_EMAILS` (`role = 'admin'`).
 * - Demotes any existing `role = 'admin'` user whose email is NOT listed in `ADMIN_EMAILS`
 *   (or demotes all admins when `ADMIN_EMAILS` is empty/unset — fail-closed).
 * - Appends a system audit row in `admin_audit_logs` whenever at least one promotion
 *   or demotion occurs (preventing no-op log noise on normal boots).
 */
export async function syncAdminRolesFromEnv(
  database: AppDatabase = db,
  rawEnv: string | undefined = process.env.ADMIN_EMAILS,
  actorUserId: string | null = null
): Promise<AdminRoleSyncResult> {
  const configuredEmails = parseAdminEmails(rawEnv);

  return withDbRetry(async () => {
    return database.transaction(async (tx) => {
      const now = new Date();
      let promotedEmails: string[] = [];
      let demotedEmails: string[] = [];

      if (configuredEmails.length > 0) {
        const promotedRows = await tx
          .update(users)
          .set({ role: "admin", updatedAt: now })
          .where(
            and(
              eq(users.emailVerified, true),
              eq(users.role, "user"),
              inArray(sql`lower(${users.email})`, configuredEmails)
            )
          )
          .returning({ email: users.email });

        promotedEmails = promotedRows.map((row) => row.email.toLowerCase());

        const demotedRows = await tx
          .update(users)
          .set({ role: "user", updatedAt: now })
          .where(
            and(
              eq(users.role, "admin"),
              notInArray(sql`lower(${users.email})`, configuredEmails)
            )
          )
          .returning({ email: users.email });

        demotedEmails = demotedRows.map((row) => row.email.toLowerCase());
      } else {
        // Fail-closed: if ADMIN_EMAILS is unset/empty, demote all existing admins
        const demotedRows = await tx
          .update(users)
          .set({ role: "user", updatedAt: now })
          .where(eq(users.role, "admin"))
          .returning({ email: users.email });

        demotedEmails = demotedRows.map((row) => row.email.toLowerCase());
      }

      const activeAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"));

      if (promotedEmails.length > 0 || demotedEmails.length > 0) {
        await tx.insert(adminAuditLogs).values({
          actorUserId,
          action: "admin.roles_synced",
          targetType: "system",
          targetId: null,
          metadataJson: JSON.stringify({
            configuredCount: configuredEmails.length,
            promotedCount: promotedEmails.length,
            demotedCount: demotedEmails.length,
            promotedEmails,
            demotedEmails,
          }),
          createdAt: Date.now(),
        });
      }

      return {
        configuredEmails,
        promotedEmails,
        demotedEmails,
        activeAdminCount: activeAdmins.length,
      };
    });
  });
}

/**
 * Single-flight per-process startup synchronization keyed by `ADMIN_EMAILS` fingerprint.
 * Runs automatically from `src/instrumentation.ts` on server boot and re-runs
 * automatically if `process.env.ADMIN_EMAILS` changes at runtime (e.g. tests or env updates).
 */
export async function ensureAdminRolesSyncedForCurrentEnv(
  database: AppDatabase = db
): Promise<AdminRoleSyncResult | null> {
  if (database !== db) {
    return syncAdminRolesFromEnv(database, process.env.ADMIN_EMAILS);
  }

  const fingerprint = getAdminEmailsFingerprint(process.env.ADMIN_EMAILS);
  if (
    globalForAdminSync.__folioAdminSyncFingerprint === fingerprint &&
    globalForAdminSync.__folioAdminSyncPromise
  ) {
    return globalForAdminSync.__folioAdminSyncPromise;
  }

  globalForAdminSync.__folioAdminSyncFingerprint = fingerprint;
  const promise = syncAdminRolesFromEnv(db, process.env.ADMIN_EMAILS).catch(
    (error) => {
      // Reset fingerprint on failure so a subsequent request after migration can retry
      if (globalForAdminSync.__folioAdminSyncFingerprint === fingerprint) {
        globalForAdminSync.__folioAdminSyncFingerprint = undefined;
        globalForAdminSync.__folioAdminSyncPromise = undefined;
      }
      throw error;
    }
  );

  globalForAdminSync.__folioAdminSyncPromise = promise;
  return promise;
}

export function resetAdminSyncCacheForTests(): void {
  globalForAdminSync.__folioAdminSyncFingerprint = undefined;
  globalForAdminSync.__folioAdminSyncPromise = undefined;
}
