import { NextResponse, type NextRequest } from "next/server";
import type { PlatformTimelineCategory } from "@/server/dal/admin-repository";
import { requireAdmin } from "@/server/dal/auth-guard";
import { DalError } from "@/server/dal/errors";
import { adminService } from "@/server/services/admin-service";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

const VALID_ROLES = new Set(["all", "admin", "user"]);
const VALID_STATUSES = new Set(["all", "active", "suspended", "unverified"]);
const VALID_CATEGORIES = new Set<PlatformTimelineCategory>([
  "all",
  "audit",
  "project",
  "user",
  "reminder",
]);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const params = request.nextUrl.searchParams;
    const section = params.get("section") ?? "all";
    const query = params.get("q")?.trim() || undefined;
    const rawRole = params.get("role") ?? "all";
    const rawStatus = params.get("status") ?? "all";
    const rawCategory = (params.get("timelineCategory") ??
      "all") as PlatformTimelineCategory;
    const rawPage = Number(params.get("page") ?? "1");

    const roleFilter = VALID_ROLES.has(rawRole)
      ? (rawRole as "all" | "admin" | "user")
      : "all";
    const statusFilter = VALID_STATUSES.has(rawStatus)
      ? (rawStatus as "all" | "active" | "suspended" | "unverified")
      : "all";
    const timelineCategory = VALID_CATEGORIES.has(rawCategory)
      ? rawCategory
      : "all";
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

    if (section === "overview") {
      const summary = await adminService.getOverviewSummary(14);
      return NextResponse.json(summary, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    if (section === "users") {
      const usersSection = await adminService.getUsersDirectorySection({
        query,
        roleFilter,
        statusFilter,
        page,
        pageSize: 20,
      });
      return NextResponse.json(usersSection, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    if (section === "timeline") {
      const timelineSection = await adminService.getTimelineSection(
        timelineCategory,
        60
      );
      return NextResponse.json(timelineSection, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    const overview = await adminService.getOverview({
      query,
      roleFilter,
      statusFilter,
      timelineCategory,
      page,
      pageSize: 20,
    });

    return NextResponse.json(overview, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof DalError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.statusCode, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to load admin overview.",
        },
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
