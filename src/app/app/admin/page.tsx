import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPortalView } from "@/components/admin/admin-portal-view";
import { getServerTimestampMs } from "@/lib/query/clock";
import { requireAdmin } from "@/server/dal/auth-guard";
import { ForbiddenError, UnauthorizedError } from "@/server/dal/errors";
import { adminService } from "@/server/services/admin-service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    await requireAdmin();
    return { title: "Admin" };
  } catch {
    return { title: "Not Found" };
  }
}

export default async function AdminPortalPage() {
  let user;
  try {
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
  const initialData = await adminService.getOverview();

  return (
    <AdminPortalView
      currentUserId={user.id}
      timezone={user.timezone || "UTC"}
      initialData={initialData}
      initialFetchedAtMs={initialFetchedAtMs}
    />
  );
}
