import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { isAdminEmail } from "@/server/admin-policy";
import { auth, type BetterAuthSession } from "@/server/auth";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projectMembers,
  tasks,
  users,
  type ProjectMemberRecord,
  type ProjectRole,
  type ReminderTarget,
} from "@/server/db/schema";
import { ensureAdminRolesSyncedForCurrentEnv } from "@/server/services/admin-role-sync";
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
    userId: string,
    executor?: DbExecutor
  ): Promise<Pick<ProjectMemberRecord, "projectId" | "userId" | "role"> | null>;
}

const getCachedDefaultSession = cache(
  async (): Promise<BetterAuthSession | null> => {
    const requestHeaders = await headers();
    return auth.api.getSession({ headers: requestHeaders });
  }
);

const defaultSessionResolver: SessionResolver = {
  getSession() {
    return getCachedDefaultSession();
  },
};

export function createDrizzleMembershipLookup(
  database: AppDatabase = db
): ProjectMembershipLookup {
  return {
    async findMembership(
      projectId: string,
      userId: string,
      executor: DbExecutor = database
    ) {
      const [membership] = await executor
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

  if (result.user.isSuspended) {
    throw new ForbiddenError("This account has been suspended.");
  }

  return result;
}

export interface LiveUserShellStatus {
  isAdmin: boolean;
  isSuspended: boolean;
  email: string | null;
  name: string | null;
  timezone: string | null;
  emailRemindersEnabled: boolean | null;
}

async function queryLiveUserShellStatus(
  userId: string,
  database: AppDatabase,
  rawAdminEnv: string | undefined
): Promise<LiveUserShellStatus> {
  if (!userId) {
    return {
      isAdmin: false,
      isSuspended: false,
      email: null,
      name: null,
      timezone: null,
      emailRemindersEnabled: null,
    };
  }

  if (database === db) {
    await ensureAdminRolesSyncedForCurrentEnv(database).catch(() => null);
  }

  const [row] = await database
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      role: users.role,
      isSuspended: users.isSuspended,
      timezone: users.timezone,
      emailRemindersEnabled: users.emailRemindersEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return {
      isAdmin: false,
      isSuspended: false,
      email: null,
      name: null,
      timezone: null,
      emailRemindersEnabled: null,
    };
  }

  if (row.isSuspended) {
    return {
      isAdmin: false,
      isSuspended: true,
      email: row.email,
      name: row.name,
      timezone: row.timezone,
      emailRemindersEnabled: row.emailRemindersEnabled,
    };
  }

  const allowedByEnv = row.emailVerified && isAdminEmail(row.email, rawAdminEnv);

  if (allowedByEnv && row.role !== "admin") {
    await database
      .update(users)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(users.id, row.id));
  } else if (!allowedByEnv && row.role === "admin") {
    await database
      .update(users)
      .set({ role: "user", updatedAt: new Date() })
      .where(eq(users.id, row.id));
  }

  return {
    isAdmin: allowedByEnv,
    isSuspended: row.isSuspended,
    email: row.email,
    name: row.name,
    timezone: row.timezone,
    emailRemindersEnabled: row.emailRemindersEnabled,
  };
}

/**
 * Per-request memoized live Turso user + admin status lookup so `AppShellLayout`
 * and child RSC pages (`AdminPortalPage`, etc.) share ONE database read per request
 * without ever caching RBAC state across requests.
 */
const getCachedDefaultUserShellStatus = cache(
  (userId: string): Promise<LiveUserShellStatus> =>
    queryLiveUserShellStatus(userId, db, process.env.ADMIN_EMAILS)
);

export async function resolveLiveUserShellStatus(
  userId: string,
  database: AppDatabase = db,
  rawAdminEnv: string | undefined = process.env.ADMIN_EMAILS
): Promise<LiveUserShellStatus> {
  if (database === db && rawAdminEnv === process.env.ADMIN_EMAILS) {
    return getCachedDefaultUserShellStatus(userId);
  }
  return queryLiveUserShellStatus(userId, database, rawAdminEnv);
}

/**
 * Evaluates live platform admin status directly against Turso AND `ADMIN_EMAILS`.
 * Auto-promotes/demotes the caller's DB row if `ADMIN_EMAILS` changed without restart.
 */
export async function resolveLiveAdminStatus(
  userId: string,
  database: AppDatabase = db,
  rawAdminEnv: string | undefined = process.env.ADMIN_EMAILS
): Promise<{
  isAdmin: boolean;
  isSuspended: boolean;
  email: string | null;
}> {
  const status = await resolveLiveUserShellStatus(userId, database, rawAdminEnv);
  return {
    isAdmin: status.isAdmin,
    isSuspended: status.isSuspended,
    email: status.email,
  };
}

/**
 * Defense-in-depth platform admin guard backed directly by Turso + live `ADMIN_EMAILS`.
 * Throws `UnauthorizedError` when unauthenticated and `ForbiddenError` for non-admins
 * or suspended accounts. Never trusts client state or stale session cookies.
 */
export async function requireAdmin(
  resolver: SessionResolver = defaultSessionResolver,
  database: AppDatabase = db,
  rawAdminEnv: string | undefined = process.env.ADMIN_EMAILS
): Promise<AuthenticatedContext> {
  const authContext = await requireSession(resolver);
  const status = await resolveLiveAdminStatus(
    authContext.user.id,
    database,
    rawAdminEnv
  );

  if (status.isSuspended) {
    throw new ForbiddenError("This account has been suspended.");
  }

  if (!status.isAdmin) {
    throw new ForbiddenError("Administrator access required.");
  }

  return authContext;
}

/**
 * Defense-in-depth project authorization guard backed directly by Turso's
 * composite primary key `(project_id, user_id)`.
 *
 * SECURITY INVARIANT: Redis is NEVER used for write or security authorization—
 * role changes and member removals take effect instantaneously with zero TTL gap.
 */
export async function assertProjectRole(
  projectId: string,
  userId: string,
  allowedRoles: readonly ProjectRole[],
  lookup: ProjectMembershipLookup = defaultMembershipLookup,
  executor?: DbExecutor
): Promise<Pick<ProjectMemberRecord, "projectId" | "userId" | "role">> {
  if (!projectId || !userId || allowedRoles.length === 0) {
    throw new ForbiddenError();
  }

  const membership = await lookup.findMembership(projectId, userId, executor);

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError();
  }

  return membership;
}

/**
 * Centralized entity read authorization guard backed directly by Turso.
 * - Personal items (`projectId === null`): strictly requires `item.userId === userId`.
 * - Project items (`projectId !== null`): strictly requires membership in `project_members`
 *   for `(projectId, userId)`.
 *
 * Enforced both on reminder creation/reschedule AND inside Inngest delivery
 * immediately before loading entity content or dispatching Push/Email.
 */
export async function canUserReadEntity(
  userId: string,
  target: ReminderTarget | { taskId?: string | null; noteId?: string | null },
  executor: DbExecutor = db
): Promise<boolean> {
  if (!userId) return false;

  const hasTask = typeof target.taskId === "string" && target.taskId.length > 0;
  const hasNote = typeof target.noteId === "string" && target.noteId.length > 0;

  // Enforce exact mutual exclusivity
  if (hasTask === hasNote) {
    return false;
  }

  if (hasTask && target.taskId) {
    const [task] = await executor
      .select({
        userId: tasks.userId,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(eq(tasks.id, target.taskId))
      .limit(1);

    if (!task) return false;
    if (task.projectId === null) {
      return task.userId === userId;
    }

    const [membership] = await executor
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, task.projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    return Boolean(membership);
  }

  if (hasNote && target.noteId) {
    const [note] = await executor
      .select({
        userId: notes.userId,
        projectId: notes.projectId,
      })
      .from(notes)
      .where(eq(notes.id, target.noteId))
      .limit(1);

    if (!note) return false;
    if (note.projectId === null) {
      return note.userId === userId;
    }

    const [membership] = await executor
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, note.projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    return Boolean(membership);
  }

  return false;
}
