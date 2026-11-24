import { describe, expect, it, vi } from "vitest";
import {
  CommentWindowClosedError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/server/dal/errors";

vi.mock("@/server/dal/auth-guard", () => ({
  requireSession: vi.fn(),
  resolveLiveAdminStatus: vi.fn(),
}));

vi.mock("@/server/dal/user-repository", () => ({
  userRepository: {
    getById: vi.fn(),
  },
}));

vi.mock("@/server/dal/workspace-repository", () => ({
  workspaceRepository: {
    getSidebarSummary: vi.fn(),
  },
}));

vi.mock("@/server/dal/notification-repository", () => ({
  notificationRepository: {
    listRecentForUser: vi.fn(),
  },
}));

import { GET as getBootstrap } from "@/app/api/workspace/bootstrap/route";
import {
  requireSession,
  resolveLiveAdminStatus,
} from "@/server/dal/auth-guard";
import { notificationRepository } from "@/server/dal/notification-repository";
import { userRepository } from "@/server/dal/user-repository";
import { workspaceRepository } from "@/server/dal/workspace-repository";
import { withWorkspaceAuth, workspaceJson } from "@/server/http/workspace-api";

const mockedRequireSession = vi.mocked(requireSession);

describe("withWorkspaceAuth (GET /api/workspace/* security boundary)", () => {
  it("returns 401 with Cache-Control: private, no-store when unauthenticated", async () => {
    mockedRequireSession.mockRejectedValueOnce(new UnauthorizedError());

    const res = await withWorkspaceAuth(async () => workspaceJson({ ok: true }));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      },
    });
  });

  it("maps Forbidden, CommentWindowClosed, NotFound, and Validation errors cleanly with private, no-store", async () => {
    const fakeAuth = {
      session: { id: "s1", userId: "u1", token: "tok", expiresAt: new Date() },
      user: {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        timezone: "UTC",
        emailRemindersEnabled: true,
      },
    } as Awaited<ReturnType<typeof requireSession>>;

    mockedRequireSession.mockResolvedValue(fakeAuth);

    const forbidden = await withWorkspaceAuth(async () => {
      throw new ForbiddenError("Cross-tenant access denied.");
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");

    const locked = await withWorkspaceAuth(async () => {
      throw new CommentWindowClosedError({
        opensAtUtcMs: Date.now() + 3600_000,
        summary: "Opens Sat 00:00",
      });
    });
    expect(locked.status).toBe(403);
    expect(locked.headers.get("cache-control")).toBe("private, no-store");

    const missing = await withWorkspaceAuth(async () => {
      throw new NotFoundError("Project not found.");
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");

    const invalid = await withWorkspaceAuth(async () => {
      throw new ValidationError("Bad view.");
    });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");

    const ok = await withWorkspaceAuth(async ({ user }) =>
      workspaceJson({ userId: user.id })
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await ok.json()).toEqual({ userId: "u1" });
  });

  it("GET /api/workspace/bootstrap returns fresh DB profile name and timezone rather than stale cookie cache", async () => {
    mockedRequireSession.mockResolvedValueOnce({
      session: { id: "s1", userId: "u1", token: "tok", expiresAt: new Date() },
      user: {
        id: "u1",
        name: "Stale Cookie Name",
        email: "ada@example.com",
        emailVerified: true,
        timezone: "UTC",
        emailRemindersEnabled: true,
      },
    } as Awaited<ReturnType<typeof requireSession>>);

    vi.mocked(userRepository.getById).mockResolvedValueOnce({
      id: "u1",
      name: "Fresh DB Name",
      email: "ada@example.com",
      emailVerified: true,
      role: "admin",
      isSuspended: false,
      timezone: "Africa/Kampala",
      emailRemindersEnabled: true,
    });
    vi.mocked(resolveLiveAdminStatus).mockResolvedValueOnce({
      isAdmin: true,
      isSuspended: false,
      email: "ada@example.com",
    });
    vi.mocked(workspaceRepository.getSidebarSummary).mockResolvedValueOnce({
      inboxCount: 1,
      todayCount: 1,
      upcomingCount: 0,
      notesCount: 0,
      remindersCount: 0,
      habitsCount: 0,
      unreadNotificationsCount: 0,
      projects: [],
    });
    vi.mocked(notificationRepository.listRecentForUser).mockResolvedValueOnce(
      []
    );

    const res = await getBootstrap();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const json = (await res.json()) as {
      userName: string;
      timezone: string;
      isAdmin: boolean;
    };
    expect(json.userName).toBe("Fresh DB Name");
    expect(json.timezone).toBe("Africa/Kampala");
    expect(json.isAdmin).toBe(true);
  });
});
