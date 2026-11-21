import { describe, expect, it } from "vitest";
import {
  assertProjectRole,
  requireSession,
  type ProjectMembershipLookup,
  type SessionResolver,
} from "@/server/dal/auth-guard";
import { ForbiddenError, UnauthorizedError } from "@/server/dal/errors";
import type { BetterAuthSession } from "@/server/auth";

function createMockSession(userId = "01JTESTUSER000000000000001"): BetterAuthSession {
  const now = new Date();
  return {
    session: {
      id: "01JTESTSESS000000000000001",
      userId,
      token: "session-token-mock",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      image: null,
      timezone: "UTC",
      emailRemindersEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe("requireSession", () => {
  it("returns authenticated session and user when valid", async () => {
    const mockSession = createMockSession();
    const resolver: SessionResolver = {
      async getSession() {
        return mockSession;
      },
    };

    const result = await requireSession(resolver);
    expect(result.user.id).toBe(mockSession.user.id);
    expect(result.session.id).toBe(mockSession.session.id);
  });

  it("throws UnauthorizedError when session is null", async () => {
    const resolver: SessionResolver = {
      async getSession() {
        return null;
      },
    };

    await expect(requireSession(resolver)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});

describe("assertProjectRole", () => {
  const projectId = "01JPROJ0000000000000000001";
  const ownerId = "01JUSER0000000000000000001";
  const editorId = "01JUSER0000000000000000002";
  const viewerId = "01JUSER0000000000000000003";
  const outsiderId = "01JUSER0000000000000000004";

  const lookup: ProjectMembershipLookup = {
    async findMembership(pid, uid) {
      if (pid !== projectId) return null;
      if (uid === ownerId) return { projectId: pid, userId: uid, role: "owner" };
      if (uid === editorId) return { projectId: pid, userId: uid, role: "editor" };
      if (uid === viewerId) return { projectId: pid, userId: uid, role: "viewer" };
      return null;
    },
  };

  it("permits members whose role is included in allowedRoles", async () => {
    const owner = await assertProjectRole(
      projectId,
      ownerId,
      ["owner"],
      lookup
    );
    expect(owner.role).toBe("owner");

    const editor = await assertProjectRole(
      projectId,
      editorId,
      ["owner", "editor"],
      lookup
    );
    expect(editor.role).toBe("editor");

    const viewer = await assertProjectRole(
      projectId,
      viewerId,
      ["owner", "editor", "viewer"],
      lookup
    );
    expect(viewer.role).toBe("viewer");
  });

  it("throws ForbiddenError when member role is insufficient", async () => {
    await expect(
      assertProjectRole(projectId, viewerId, ["owner", "editor"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      assertProjectRole(projectId, editorId, ["owner"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError for non-members and empty inputs", async () => {
    await expect(
      assertProjectRole(
        projectId,
        outsiderId,
        ["owner", "editor", "viewer"],
        lookup
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      assertProjectRole("", ownerId, ["owner"], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      assertProjectRole(projectId, ownerId, [], lookup)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
