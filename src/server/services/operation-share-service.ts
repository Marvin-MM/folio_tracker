import { createHash, randomBytes } from "node:crypto";
import {
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  assertOperationCapability,
  resolveOperationAccess,
} from "@/server/dal/operation-auth";
import {
  operationsSocialRepository,
  type OperationInvitationWithMeta,
  type OperationMemberWithUser,
  type OperationsSocialRepository,
  type QuickPickShareContact,
} from "@/server/dal/operations-social";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type {
  OperationDomain,
  OperationInvitationRecord,
  OperationMemberRecord,
  OperationMemberRole,
} from "@/server/db/schema";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function mintInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashInviteToken(rawToken),
  };
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface OperationShareDashboardPayload {
  operationId: string;
  operationTitle: string;
  operationSlug: string;
  visibility: "private" | "unlisted" | "public";
  allowForking: boolean;
  shareWithProject: boolean;
  hasUnlistedLink: boolean;
  linkedProject: { id: string; name: string; colorToken: string } | null;
  members: OperationMemberWithUser[];
  pendingInvitations: OperationInvitationRecord[];
  quickPickContacts: QuickPickShareContact[];
}

export interface OperationInvitePreview {
  status: "valid" | "not_found" | "expired" | "already_used";
  operationTitle?: string;
  operationDomain?: OperationDomain;
  inviterName?: string;
  inviterHandle?: string | null;
  role?: OperationMemberRole;
  targetEmailHint?: string;
  expiresAt?: number;
}

export interface SendOperationInviteResult {
  /** Uniform anti-enumeration status text safe to display in UI. */
  message: string;
  invitationId: string | null;
  /** Returned ONLY when an external invite URL was minted for sharing manually. */
  inviteUrl: string | null;
}

export interface OperationShareServiceDeps {
  database?: AppDatabase;
  social?: OperationsSocialRepository;
  users?: UserRepository;
  projects?: ProjectRepository;
  eventBus?: EventBus;
  rateLimiter?: RateLimiter;
  now?: () => number;
}

function maskEmailHint(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

export class OperationShareService {
  private readonly database: AppDatabase;
  private readonly social: OperationsSocialRepository;
  private readonly users: UserRepository;
  private readonly projects: ProjectRepository;
  private readonly eventBus: EventBus;
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(deps: OperationShareServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.social = deps.social ?? operationsSocialRepository;
    this.users = deps.users ?? userRepository;
    this.projects = deps.projects ?? projectRepository;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.now = deps.now ?? (() => Date.now());
  }

  private async enforceInviteRateLimit(ownerId: string): Promise<void> {
    const rate = await this.rateLimiter.limit("operation_invite", ownerId);
    if (!rate.allowed) {
      throw new RateLimitError({
        message: `Invite limit reached. Please retry in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        limit: rate.limit,
        remaining: rate.remaining,
        resetAtMs: rate.resetAtMs,
      });
    }
  }

  async getShareDashboard(
    userId: string,
    operationId: string
  ): Promise<OperationShareDashboardPayload> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can view or manage sharing settings."
    );

    const { operation } = access;
    const [members, pendingInvitations, quickPickContacts, linkedProjectRow] =
      await Promise.all([
        this.social.listMembersForOperation(operation.id),
        this.social.listPendingInvitationsForOperation(operation.id),
        this.social.listQuickPickContacts(userId),
        operation.projectId
          ? this.projects.getProjectById(operation.projectId)
          : Promise.resolve(null),
      ]);

    const existingMemberIds = new Set(members.map((m) => m.userId));
    const filteredContacts = quickPickContacts.filter(
      (c) => !existingMemberIds.has(c.userId)
    );

    return {
      operationId: operation.id,
      operationTitle: operation.title,
      operationSlug: operation.slug,
      visibility: operation.visibility,
      allowForking: operation.allowForking,
      shareWithProject: operation.shareWithProject,
      hasUnlistedLink: Boolean(operation.unlistedTokenHash),
      linkedProject: linkedProjectRow
        ? {
            id: linkedProjectRow.id,
            name: linkedProjectRow.name,
            colorToken: linkedProjectRow.colorToken,
          }
        : null,
      members,
      pendingInvitations,
      quickPickContacts: filteredContacts,
    };
  }

  /**
   * 1-click grant/invite for a known Follower, Circle peer, or Project teammate.
   * Creates an immediate in-app `operation_invitations` row + notification via Inngest.
   */
  async inviteQuickPickUser(
    ownerId: string,
    operationId: string,
    input: { targetUserId: string; role: OperationMemberRole }
  ): Promise<SendOperationInviteResult> {
    if (!input.targetUserId || input.targetUserId === ownerId) {
      throw new ValidationError("You cannot invite yourself to your own operation.");
    }

    const access = await resolveOperationAccess(
      { operationId, sessionUserId: ownerId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can invite collaborators or viewers."
    );

    await this.enforceInviteRateLimit(ownerId);

    const nowMs = this.now();
    const expiresAt = nowMs + INVITE_TTL_MS;

    const { invitation, postCommitEvent } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const recheck = await resolveOperationAccess(
          { operationId, sessionUserId: ownerId },
          tx
        );
        assertOperationCapability(recheck, "canManageSharing");

        const ownerRow = await this.users.getById(ownerId, tx);
        const targetUser = await this.users.getById(input.targetUserId, tx);
        if (!targetUser || targetUser.isSuspended || !targetUser.emailVerified) {
          throw new NotFoundError("Selected user is not available.");
        }

        const existingPending = await this.social.findPendingInvitationForTarget(
          operationId,
          targetUser.email,
          tx
        );
        if (existingPending && existingPending.expiresAt > nowMs) {
          throw new ConflictError("An invitation is already pending for this user.");
        }

        const created = await this.social.createInvitation(
          {
            operationId,
            invitedById: ownerId,
            targetUserId: targetUser.id,
            targetEmail: targetUser.email,
            tokenHash: null,
            role: input.role,
            expiresAt,
            nowMs,
          },
          tx
        );

        const event: AppDomainEvent = {
          id: `op-inv-inapp-${created.id}`,
          name: "app/operation.invited_in_app",
          data: {
            invitationId: created.id,
            operationId: recheck.operation.id,
            operationTitle: recheck.operation.title,
            inviterName: ownerRow?.name ?? "A Folio user",
            targetUserId: targetUser.id,
            role: input.role,
          },
        };

        return { invitation: created, postCommitEvent: event };
      })
    );

    try {
      await this.eventBus.emit(postCommitEvent);
    } catch (error) {
      console.warn(
        "Operation in-app invite event emit failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
    }

    return {
      message: "Invitation sent.",
      invitationId: invitation.id,
      inviteUrl: null,
    };
  }

  /**
   * Anti-enumeration Smart Dual Invite by email:
   * - Existing verified user -> in-app `operation_invitations` row (`targetUserId` set, `tokenHash = null`).
   * - Non-user email -> SHA-256 hashed 7-day token link (`/invite/operation/[token]`) via Inngest + Resend.
   * Returns a uniform UI message so attackers cannot probe registered emails.
   */
  async inviteByEmail(
    ownerId: string,
    operationId: string,
    input: {
      email: string;
      role: OperationMemberRole;
      baseUrl?: string;
    }
  ): Promise<SendOperationInviteResult> {
    const targetEmail = normalizeEmail(input.email);
    if (!targetEmail || !targetEmail.includes("@")) {
      throw new ValidationError("Enter a valid email address.");
    }

    const access = await resolveOperationAccess(
      { operationId, sessionUserId: ownerId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can invite collaborators or viewers."
    );

    await this.enforceInviteRateLimit(ownerId);

    const nowMs = this.now();
    const expiresAt = nowMs + INVITE_TTL_MS;
    const baseUrl = (
      input.baseUrl ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000"
    ).replace(/\/+$/, "");

    const txResult = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const recheck = await resolveOperationAccess(
          { operationId, sessionUserId: ownerId },
          tx
        );
        assertOperationCapability(recheck, "canManageSharing");

        const ownerRow = await this.users.getById(ownerId, tx);
        if (ownerRow && normalizeEmail(ownerRow.email) === targetEmail) {
          throw new ValidationError("You already own this operation.");
        }

        const existingPending = await this.social.findPendingInvitationForTarget(
          operationId,
          targetEmail,
          tx
        );
        if (existingPending && existingPending.expiresAt > nowMs) {
          // Uniform anti-enumeration response — do not reveal whether pending is in-app vs external
          return {
            invitationId: existingPending.id,
            inviteUrl: null as string | null,
            event: null as AppDomainEvent | null,
          };
        }

        const existingUser = await this.social.findVerifiedUserByEmail(
          targetEmail,
          tx
        );

        if (existingUser) {
          const created = await this.social.createInvitation(
            {
              operationId,
              invitedById: ownerId,
              targetUserId: existingUser.id,
              targetEmail,
              tokenHash: null,
              role: input.role,
              expiresAt,
              nowMs,
            },
            tx
          );

          return {
            invitationId: created.id,
            inviteUrl: null as string | null,
            event: {
              id: `op-inv-inapp-${created.id}`,
              name: "app/operation.invited_in_app" as const,
              data: {
                invitationId: created.id,
                operationId: recheck.operation.id,
                operationTitle: recheck.operation.title,
                inviterName: ownerRow?.name ?? "A Folio user",
                targetUserId: existingUser.id,
                role: input.role,
              },
            },
          };
        }

        const { rawToken, tokenHash } = mintInviteToken();
        const created = await this.social.createInvitation(
          {
            operationId,
            invitedById: ownerId,
            targetUserId: null,
            targetEmail,
            tokenHash,
            role: input.role,
            expiresAt,
            nowMs,
          },
          tx
        );
        const inviteUrl = `${baseUrl}/invite/operation/${rawToken}`;

        return {
          invitationId: created.id,
          inviteUrl,
          event: {
            id: `op-inv-email-${created.id}`,
            name: "app/operation.invited_email" as const,
            data: {
              invitationId: created.id,
              operationId: recheck.operation.id,
              operationTitle: recheck.operation.title,
              inviterName: ownerRow?.name ?? "A Folio user",
              targetEmail,
              role: input.role,
              inviteUrl,
            },
          },
        };
      })
    );

    if (txResult.event) {
      try {
        await this.eventBus.emit(txResult.event);
      } catch (error) {
        console.warn(
          "Operation invite event emit failed:",
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    // Uniform message regardless of existing user vs non-user (anti-enumeration)
    return {
      message: "Invitation sent.",
      invitationId: txResult.invitationId,
      inviteUrl: txResult.inviteUrl,
    };
  }

  async previewTokenInvite(rawToken: string): Promise<OperationInvitePreview> {
    const clean = rawToken.trim();
    if (!clean || clean.length < 16) {
      return { status: "not_found" };
    }
    const found = await this.social.getInvitationByTokenHash(
      hashInviteToken(clean)
    );
    if (!found) {
      return { status: "not_found" };
    }
    if (found.invitation.status !== "pending") {
      return {
        status: "already_used",
        operationTitle: found.operationTitle,
        inviterName: found.inviterName,
        role: found.invitation.role,
      };
    }
    if (found.invitation.expiresAt <= this.now()) {
      return {
        status: "expired",
        operationTitle: found.operationTitle,
        inviterName: found.inviterName,
        role: found.invitation.role,
      };
    }
    return {
      status: "valid",
      operationTitle: found.operationTitle,
      operationDomain: found.operationDomain,
      inviterName: found.inviterName,
      inviterHandle: found.inviterHandle,
      role: found.invitation.role,
      targetEmailHint: maskEmailHint(found.invitation.targetEmail),
      expiresAt: found.invitation.expiresAt,
    };
  }

  async acceptInAppInvitation(
    userId: string,
    invitationId: string
  ): Promise<{ operationId: string; member: OperationMemberRecord }> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const userRow = await this.users.getById(userId, tx);
        const invite = await this.social.getInvitationById(invitationId, tx);
        if (!userRow || !invite) {
          throw new NotFoundError("Invitation not found.");
        }

        const matchesUser =
          invite.targetUserId === userId ||
          normalizeEmail(userRow.email) === normalizeEmail(invite.targetEmail);
        if (!matchesUser) {
          throw new ForbiddenError("This invitation is addressed to another account.");
        }

        // Single atomic conditional claim: guarantees strictly ONE winner under concurrency
        const claimed = await this.social.claimInvitationAcceptAtomically(
          invite.id,
          nowMs,
          tx
        );
        if (!claimed) {
          throw new ConflictError(
            "This invitation has already been accepted, declined, or expired."
          );
        }

        const member = await this.social.upsertMember(
          {
            operationId: claimed.operationId,
            userId,
            role: claimed.role,
            grantedById: claimed.invitedById,
            nowMs,
          },
          tx
        );

        return { operationId: claimed.operationId, member };
      })
    );
  }

  async acceptTokenInvitation(
    userId: string,
    rawToken: string
  ): Promise<{ operationId: string; member: OperationMemberRecord }> {
    const clean = rawToken.trim();
    if (!clean) {
      throw new NotFoundError("Invitation not found.");
    }
    const tokenHash = hashInviteToken(clean);
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const userRow = await this.users.getById(userId, tx);
        const found = await this.social.getInvitationByTokenHash(tokenHash, tx);
        if (!userRow || !found) {
          throw new NotFoundError("Invitation not found.");
        }
        if (!userRow.emailVerified) {
          throw new ForbiddenError(
            "Please verify your email address before accepting invitations."
          );
        }
        if (
          normalizeEmail(userRow.email) !==
          normalizeEmail(found.invitation.targetEmail)
        ) {
          throw new EmailMismatchError(
            "Your signed-in email does not match the invited email address."
          );
        }

        const claimed = await this.social.claimInvitationAcceptAtomically(
          found.invitation.id,
          nowMs,
          tx
        );
        if (!claimed) {
          throw new ConflictError(
            "This invitation has already been accepted, revoked, or expired."
          );
        }

        const member = await this.social.upsertMember(
          {
            operationId: claimed.operationId,
            userId,
            role: claimed.role,
            grantedById: claimed.invitedById,
            nowMs,
          },
          tx
        );

        return { operationId: claimed.operationId, member };
      })
    );
  }

  async declineInvitation(userId: string, invitationId: string): Promise<void> {
    const nowMs = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const userRow = await this.users.getById(userId, tx);
        const invite = await this.social.getInvitationById(invitationId, tx);
        if (!userRow || !invite) {
          throw new NotFoundError("Invitation not found.");
        }
        const matchesUser =
          invite.targetUserId === userId ||
          normalizeEmail(userRow.email) === normalizeEmail(invite.targetEmail);
        if (!matchesUser) {
          throw new ForbiddenError();
        }
        const updated = await this.social.updateInvitationStatusAtomically(
          invite.id,
          "pending",
          "declined",
          nowMs,
          tx
        );
        if (!updated) {
          throw new ConflictError("Invitation is no longer pending.");
        }
      })
    );
  }

  async revokeInvitation(
    ownerId: string,
    operationId: string,
    invitationId: string
  ): Promise<void> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: ownerId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can revoke invitations."
    );

    const invite = await this.social.getInvitationById(invitationId);
    if (!invite || invite.operationId !== operationId) {
      throw new NotFoundError("Invitation not found.");
    }

    await withDbRetry(() =>
      this.social.updateInvitationStatusAtomically(
        invitationId,
        "pending",
        "revoked",
        this.now()
      )
    );
  }

  async updateMemberRole(
    ownerId: string,
    operationId: string,
    targetUserId: string,
    role: OperationMemberRole
  ): Promise<OperationMemberRecord> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: ownerId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can update member roles."
    );
    if (targetUserId === ownerId) {
      throw new ValidationError("Cannot change the owner's own role.");
    }

    return withDbRetry(() =>
      this.social.upsertMember({
        operationId,
        userId: targetUserId,
        role,
        grantedById: ownerId,
        nowMs: this.now(),
      })
    );
  }

  async revokeMember(
    ownerId: string,
    operationId: string,
    targetUserId: string
  ): Promise<void> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: ownerId },
      this.database
    );
    assertOperationCapability(
      access,
      "canManageSharing",
      "Only the operation owner can revoke member access."
    );

    const removed = await withDbRetry(() =>
      this.social.removeMember(operationId, targetUserId)
    );
    if (!removed) {
      throw new NotFoundError("Member not found on this operation.");
    }
  }

  async listPendingInvitationsForUser(
    userId: string
  ): Promise<OperationInvitationWithMeta[]> {
    const user = await this.users.getById(userId);
    if (!user) return [];
    return this.social.listPendingInvitationsForUser(
      userId,
      user.email,
      this.now()
    );
  }
}

export const operationShareService = new OperationShareService();
