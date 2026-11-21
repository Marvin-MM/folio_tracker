import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth, type BetterAuthSession } from "@/server/auth";
import { db, type AppDatabase } from "@/server/db";
import {
  projectMembers,
  type ProjectMemberRecord,
  type ProjectRole,
} from "@/server/db/schema";
import {
  defaultPermissionCache,
  type PermissionCache,
} from "@/server/providers/redis/permission-cache";
import { ForbiddenError, UnauthorizedError } from "./errors";

export interface AuthenticatedContext {
  session: BetterAuthSession["session"];
  user: BetterAuthSession["user"];
}

export interface SessionResolver {
  getSession(): Promise<BetterAuthSession | null>;
}

export interface ProjectMembershipLookup {
  findMembership(
    projectId: string,
    userId: string
  ): Promise<Pick<ProjectMemberRecord, "projectId" | "userId" | "role"> | null>;
}

const defaultSessionResolver: SessionResolver = {
  async getSession() {
    const requestHeaders = await headers();
    return auth.api.getSession({ headers: requestHeaders });
  },
};

export function createDrizzleMembershipLookup(
  database: AppDatabase = db
): ProjectMembershipLookup {
  return {
    async findMembership(projectId: string, userId: string) {
      const [membership] = await database
        .select({
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId)
          )
        )
        .limit(1);

      return membership ?? null;
    },
  };
}

const defaultMembershipLookup = createDrizzleMembershipLookup(db);

export async function getOptionalSession(
  resolver: SessionResolver = defaultSessionResolver
): Promise<AuthenticatedContext | null> {
  const result = await resolver.getSession();

  if (!result || !result.session || !result.user) {
    return null;
  }

  return {
    session: result.session,
    user: result.user,
  };
}

/**
 * Defense-in-depth session guard for every Server Action, Route Handler, and RSC loader.
 * Resolves the Better Auth session via request headers and throws `UnauthorizedError` if absent.
 */
export async function requireSession(
  resolver: SessionResolver = defaultSessionResolver
): Promise<AuthenticatedContext> {
  const result = await getOptionalSession(resolver);

  if (!result) {
    throw new UnauthorizedError();
  }

  return result;
}

/**
 * Defense-in-depth project authorization guard backed by `PermissionCache` (300s TTL).
 * Verifies that `userId` belongs to `projectId` with one of `allowedRoles`,
 * throwing `ForbiddenError` otherwise.
 */
export async function assertProjectRole(
  projectId: string,
  userId: string,
  allowedRoles: readonly ProjectRole[],
  lookup: ProjectMembershipLookup = defaultMembershipLookup,
  cache: PermissionCache | null = lookup === defaultMembershipLookup
    ? defaultPermissionCache
    : null
): Promise<Pick<ProjectMemberRecord, "projectId" | "userId" | "role">> {
  if (!projectId || !userId || allowedRoles.length === 0) {
    throw new ForbiddenError();
  }

  if (cache) {
    const cached = await cache.getRole(projectId, userId);
    if (cached === "none") {
      throw new ForbiddenError();
    }
    if (cached !== null) {
      if (!allowedRoles.includes(cached)) {
        throw new ForbiddenError();
      }
      return { projectId, userId, role: cached };
    }
  }

  const membership = await lookup.findMembership(projectId, userId);

  if (cache) {
    await cache.setRole(projectId, userId, membership?.role ?? "none");
  }

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError();
  }

  return membership;
}
