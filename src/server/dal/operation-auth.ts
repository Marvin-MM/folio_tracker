import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/server/db";
import {
  operationMembers,
  operations,
  projectMembers,
  type OperationRecord,
} from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

export type OperationEffectiveRole =
  | "owner"
  | "collaborator"
  | "viewer"
  | "unlisted_visitor"
  | "public_visitor";

export interface OperationCapabilities {
  canRead: boolean;
  canRun: boolean;
  canSaveRun: boolean;
  canEditSteps: boolean;
  canRollback: boolean;
  canResolveFlags: boolean;
  canFlagSteps: boolean;
  canFork: boolean;
  canChangeVisibility: boolean;
  canManageSharing: boolean;
  canRotateUnlistedLink: boolean;
  canDelete: boolean;
}

export interface ResolvedOperationAccess {
  operation: OperationRecord;
  role: OperationEffectiveRole;
  accessSource:
    | "owner"
    | "direct_member"
    | "project_inherited"
    | "unlisted_token"
    | "public";
  capabilities: OperationCapabilities;
}

export function hashUnlistedOperationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Constant-time comparison of an incoming unlisted URL token against the
 * stored SHA-256 hex digest in `operations.unlisted_token_hash`.
 */
export function timingSafeVerifyUnlistedToken(
  rawToken: string | null | undefined,
  storedHexHash: string | null | undefined
): boolean {
  if (!rawToken || !storedHexHash) return false;
  const trimmed = rawToken.trim();
  if (!trimmed) return false;
  try {
    const expected = Buffer.from(storedHexHash, "hex");
    const actual = createHash("sha256").update(trimmed).digest();
    if (expected.length !== actual.length || expected.length !== 32) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function buildCapabilitiesForRole(params: {
  role: OperationEffectiveRole;
  isAuthenticated: boolean;
  allowForking: boolean;
  isPublicOrUnlisted: boolean;
}): OperationCapabilities {
  const { role, isAuthenticated, allowForking } = params;

  switch (role) {
    case "owner":
      return {
        canRead: true,
        canRun: true,
        canSaveRun: true,
        canEditSteps: true,
        canRollback: true,
        canResolveFlags: true,
        canFlagSteps: true,
        canFork: true,
        canChangeVisibility: true,
        canManageSharing: true,
        canRotateUnlistedLink: true,
        canDelete: true,
      };
    case "collaborator":
      return {
        canRead: true,
        canRun: true,
        canSaveRun: true,
        canEditSteps: true,
        canRollback: true,
        canResolveFlags: true,
        canFlagSteps: true,
        canFork: allowForking,
        canChangeVisibility: false,
        canManageSharing: false,
        canRotateUnlistedLink: false,
        canDelete: false,
      };
    case "viewer":
      return {
        canRead: true,
        canRun: true,
        canSaveRun: true,
        canEditSteps: false,
        canRollback: false,
        canResolveFlags: false,
        canFlagSteps: true,
        canFork: allowForking,
        canChangeVisibility: false,
        canManageSharing: false,
        canRotateUnlistedLink: false,
        canDelete: false,
      };
    case "unlisted_visitor":
      return {
        canRead: true,
        canRun: true,
        canSaveRun: isAuthenticated,
        canEditSteps: false,
        canRollback: false,
        canResolveFlags: false,
        canFlagSteps: isAuthenticated,
        canFork: isAuthenticated && allowForking,
        canChangeVisibility: false,
        canManageSharing: false,
        canRotateUnlistedLink: false,
        canDelete: false,
      };
    case "public_visitor":
      return {
        canRead: true,
        canRun: true,
        canSaveRun: isAuthenticated,
        canEditSteps: false,
        canRollback: false,
        canResolveFlags: false,
        canFlagSteps: isAuthenticated,
        canFork: isAuthenticated && allowForking,
        canChangeVisibility: false,
        canManageSharing: false,
        canRotateUnlistedLink: false,
        canDelete: false,
      };
  }
}

/**
 * Direct-Turso RBAC & Visibility Resolver for Operation Blueprints.
 *
 * SECURITY INVARIANTS:
 * 1. ZERO Redis caching: every authorization check hits Turso directly so
 *    revoked access, role changes, and visibility flips take effect instantly.
 * 2. Private Isolation: unauthorized/unauthenticated requests targeting a
 *    `private` operation (or an `unlisted` operation with missing/invalid token)
 *    ALWAYS throw `NotFoundError` (HTTP 404) so existence is never leaked.
 * 3. Project Inheritance: applies ONLY when `operation.projectId` is set AND
 *    `operation.shareWithProject === true` (explicit opt-in by the owner).
 */
export async function resolveOperationAccess(
  params: {
    operationId?: string;
    slug?: string;
    sessionUserId: string | null;
    unlistedToken?: string | null;
  },
  executor: DbExecutor = db
): Promise<ResolvedOperationAccess> {
  const { operationId, slug, sessionUserId, unlistedToken } = params;

  if (!operationId && !slug) {
    throw new NotFoundError("Operation not found.");
  }

  const predicate = operationId
    ? eq(operations.id, operationId)
    : eq(operations.slug, slug!);

  // Single-RTT lookup: when authenticated, LEFT JOIN both `operation_members`
  // and `project_members` alongside `operations` so private/shared access
  // resolves in 1 SQL round-trip instead of 3 sequential queries.
  let operation: OperationRecord | undefined;
  let directMemberRole: string | null = null;
  let projectMemberRole: string | null = null;

  if (sessionUserId) {
    const [joined] = await executor
      .select({
        operation: operations,
        directMemberRole: operationMembers.role,
        projectMemberRole: projectMembers.role,
      })
      .from(operations)
      .leftJoin(
        operationMembers,
        and(
          eq(operationMembers.operationId, operations.id),
          eq(operationMembers.userId, sessionUserId)
        )
      )
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, operations.projectId),
          eq(projectMembers.userId, sessionUserId)
        )
      )
      .where(predicate)
      .limit(1);

    operation = joined?.operation;
    directMemberRole = joined?.directMemberRole ?? null;
    projectMemberRole = joined?.projectMemberRole ?? null;
  } else {
    const [row] = await executor
      .select()
      .from(operations)
      .where(predicate)
      .limit(1);
    operation = row;
  }

  if (!operation) {
    throw new NotFoundError("Operation not found.");
  }

  const isPublicOrUnlisted =
    operation.visibility === "public" || operation.visibility === "unlisted";

  // 1. Owner check
  if (sessionUserId && operation.ownerId === sessionUserId) {
    return {
      operation,
      role: "owner",
      accessSource: "owner",
      capabilities: buildCapabilitiesForRole({
        role: "owner",
        isAuthenticated: true,
        allowForking: operation.allowForking,
        isPublicOrUnlisted,
      }),
    };
  }

  // 2. Direct membership check (`operation_members`)
  if (sessionUserId && directMemberRole) {
    const role: OperationEffectiveRole =
      directMemberRole === "collaborator" ? "collaborator" : "viewer";
    return {
      operation,
      role,
      accessSource: "direct_member",
      capabilities: buildCapabilitiesForRole({
        role,
        isAuthenticated: true,
        allowForking: operation.allowForking,
        isPublicOrUnlisted,
      }),
    };
  }

  // 3. Opt-in Project Team inheritance (`shareWithProject === true`)
  if (
    sessionUserId &&
    operation.projectId &&
    operation.shareWithProject &&
    projectMemberRole
  ) {
    const inheritedRole: OperationEffectiveRole =
      projectMemberRole === "owner" || projectMemberRole === "editor"
        ? "collaborator"
        : "viewer";
    return {
      operation,
      role: inheritedRole,
      accessSource: "project_inherited",
      capabilities: buildCapabilitiesForRole({
        role: inheritedRole,
        isAuthenticated: true,
        allowForking: operation.allowForking,
        isPublicOrUnlisted,
      }),
    };
  }

  // 4. Unlisted link check (timing-safe SHA-256 verification)
  if (operation.visibility === "unlisted") {
    if (
      timingSafeVerifyUnlistedToken(unlistedToken, operation.unlistedTokenHash)
    ) {
      return {
        operation,
        role: "unlisted_visitor",
        accessSource: "unlisted_token",
        capabilities: buildCapabilitiesForRole({
          role: "unlisted_visitor",
          isAuthenticated: Boolean(sessionUserId),
          allowForking: operation.allowForking,
          isPublicOrUnlisted: true,
        }),
      };
    }
    throw new NotFoundError("Operation not found.");
  }

  // 5. Public check
  if (operation.visibility === "public" && !operation.isArchived) {
    return {
      operation,
      role: "public_visitor",
      accessSource: "public",
      capabilities: buildCapabilitiesForRole({
        role: "public_visitor",
        isAuthenticated: Boolean(sessionUserId),
        allowForking: operation.allowForking,
        isPublicOrUnlisted: true,
      }),
    };
  }

  // 6. Private isolation — NEVER leak existence with 403 to outsiders
  throw new NotFoundError("Operation not found.");
}

export function assertOperationCapability(
  access: ResolvedOperationAccess,
  capability: keyof OperationCapabilities,
  message?: string
): void {
  if (!access.capabilities[capability]) {
    throw new ForbiddenError(
      message ?? "You do not have permission to perform this action on this operation."
    );
  }
}
