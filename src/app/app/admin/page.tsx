import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPortalView } from "@/components/admin/admin-portal-view";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireAdmin } from "@/server/dal/auth-guard";
import { ForbiddenError, UnauthorizedError } from "@/server/dal/errors";
import { adminService } from "@/server/services/admin-service";


export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminPortalPage() {
  let user;
  try {
    // Reuses AppShellLayout's per-request React.cache() Turso lookup (~0ms)
    const authContext = await requireAdmin();
    user = authContext.user;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    if (error instanceof ForbiddenError) {
      // Zero discovery leak: return 404 for authenticated non-admins
      notFound();
    }
    throw error;
  }

  const initialFetchedAtMs = getServerTimestampMs();
  const initialData = await adminService.getOverviewSummary();

  return (
    <AdminPortalView
      currentUserId={user.id}
      timezone={user.timezone || "UTC"}
      initialData={initialData}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
