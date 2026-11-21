import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth, type BetterAuthSession } from "@/server/auth";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projectMembers,
  tasks,
  type ProjectMemberRecord,
  type ProjectRole,
  type ReminderTarget,
} from "@/server/db/schema";
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

  return result;
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
