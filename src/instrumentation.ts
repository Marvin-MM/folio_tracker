/**
 * Next.js 16 Server Instrumentation Hook.
 * Runs once per Node.js server boot to reconcile `users.role` against `ADMIN_EMAILS`
 * (promoting listed verified accounts and demoting removed admins automatically).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAdminRolesSyncedForCurrentEnv } = await import(
      "@/server/services/admin-role-sync"
    );

    await ensureAdminRolesSyncedForCurrentEnv().catch((error: unknown) => {
      // Safe fail-open during build/pre-migration boots; requireAdmin() still enforces live env checks
      console.warn(
        "Admin role startup sync skipped:",
        error instanceof Error ? error.message : "Unknown error"
      );
    });
  }
}
