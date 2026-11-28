import crypto from "node:crypto";
import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import { userRepository, type UserRepository } from "@/server/dal/user-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type {
  InvitationRole,
  ProjectInvitationRecord,
} from "@/server/db/schema";
import {
  defaultEventBus,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export function generateRawInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashInviteToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface CreateInvitationResult {
  invitation: ProjectInvitationRecord;
  invitePath: string;
}

export type InvitationPreviewResult =
  | {
      status: "valid";
      projectId: string;
      projectName: string;
      inviterName: string;
      role: InvitationRole;
      invitedEmailMasked: string;
      viewerEmailMatches: boolean;
      expiresAt: number;
    }
  | {
      status: "expired" | "revoked" | "accepted" | "declined" | "not_found";
      projectId?: string;
      projectName?: string;
    };

export interface ProjectInviteServiceDeps {
  database?: AppDatabase;
  projects?: ProjectRepository;
  users?: UserRepository;
  membershipLookup?: ProjectMembershipLookup;
  rateLimiter?: RateLimiter;
  eventBus?: EventBus;
  now?: () => number;
}

export class ProjectInviteService {
  private readonly database: AppDatabase;
  private readonly projects: ProjectRepository;
  private readonly users: UserRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly rateLimiter: RateLimiter;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: ProjectInviteServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.projects = deps.projects ?? projectRepository;
    this.users = deps.users ?? userRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.now = deps.now ?? (() => Date.now());
  }

  async createInvitation(
    projectId: string,
    actorId: string,
    input: { email: string; role: InvitationRole }
  ): Promise<CreateInvitationResult> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup
    );

    const limitResult = await this.rateLimiter.limit("project_invite", actorId);
    if (!limitResult.allowed) {
      throw new RateLimitError({
        message: `Invitation limit reached (20 per hour). Retry in ${limitResult.retryAfterSeconds}s.`,
        retryAfterSeconds: limitResult.retryAfterSeconds,
        limit: limitResult.limit,
        remaining: limitResult.remaining,
        resetAtMs: limitResult.resetAtMs,
      });
    }

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new ValidationError("Please provide a valid email address.");
    }

    const rawToken = generateRawInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const nowMs = this.now();
    const expiresAt = nowMs + INVITE_EXPIRY_MS;

    const { invitation, projectName, inviterName } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const project = await this.projects.getProjectById(projectId, tx);
        if (!project) {
          throw new NotFoundError("Project not found.");
        }

        const existingMember = await this.projects.findMemberByEmail(
          projectId,
          email,
          tx
        );
        if (existingMember) {
          throw new ConflictError(
            "That user is already a member of this project."
          );
        }

        const existingPending =
          await this.projects.findPendingInvitationByProjectAndEmail(
            projectId,
            email,
            tx
          );
        if (existingPending) {
          if (existingPending.expiresAt > nowMs) {
            throw new ConflictError(
              "An active invitation is already pending for this email."
            );
          }
          await this.projects.updateInvitationStatus(
            existingPending.id,
            projectId,
            "expired",
            tx
          );
        }

        const created = await this.projects.createInvitation(
          {
            projectId,
            invitedById: actorId,
            email,
            role: input.role,
            tokenHash,
            expiresAt,
          },
          tx
        );

        await this.projects.recordActivity(
          {
            projectId,
            actorId,
            action: "member.invited",
            entityType: "invitation",
            entityId: created.id,
            metadata: { recipient: maskEmail(email), role: input.role },
          },
          tx
        );

        const inviter = await this.users.getById(actorId, tx);

        return {
          invitation: created,
          projectName: project.name,
          inviterName: inviter?.name ?? "A project owner",
        };
      })
    );

    const invitePath = `/invite/${rawToken}`;
    const baseUrl =
      process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";

    try {
      await this.eventBus.emit({
        id: `project-invite-${invitation.id}`,
        name: "app/project.invited",
        data: {
          invitationId: invitation.id,
          projectId,
          projectName,
          inviterName,
          email,
          role: input.role,
          inviteUrl: `${baseUrl}${invitePath}`,
        },
      });
    } catch (error) {
      const isLocalDev =
        process.env.INNGEST_DEV === "1" ||
        process.env.NODE_ENV !== "production";
      if (isLocalDev) {
        console.warn(
          JSON.stringify({
            event: "project.invite.inngest_dev_unreachable",
            invitationId: invitation.id,
            reason: error instanceof Error ? error.message : "Unknown error",
          })
        );
      } else {
        throw error;
      }
    }

    return { invitation, invitePath };
  }

  async previewInvitationByToken(
    rawToken: string,
    viewerEmail?: string | null
  ): Promise<InvitationPreviewResult> {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      return { status: "not_found" };
    }

    const tokenHash = hashInviteToken(trimmed);
    const match = await this.projects.findInvitationByTokenHash(tokenHash);
    if (!match) {
      return { status: "not_found" };
    }

    const { invitation, projectName, inviterName } = match;

    if (invitation.status !== "pending") {
      return {
        status: invitation.status,
        projectId: invitation.projectId,
        projectName,
      };
    }

    if (invitation.expiresAt <= this.now()) {
      return {
        status: "expired",
        projectId: invitation.projectId,
        projectName,
      };
    }

    const invitedEmailNormalized = invitation.email.trim().toLowerCase();
    const viewerNormalized = viewerEmail?.trim().toLowerCase() ?? null;

    return {
      status: "valid",
      projectId: invitation.projectId,
      projectName,
      inviterName,
      role: invitation.role,
      invitedEmailMasked: maskEmail(invitation.email),
      viewerEmailMatches:
        viewerNormalized !== null && viewerNormalized === invitedEmailNormalized,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Atomically consumes a single-use invitation inside an ACID transaction via:
   * `UPDATE project_invitations SET status = 'accepted' WHERE id = ? AND project_id = ? AND status = 'pending' AND expires_at > ? RETURNING *`
   * Zero TOCTOU: strictly ONE concurrent caller succeeds; all others abort with `ConflictError`.
   */
  async acceptInvitation(
    rawToken: string,
    authenticatedUser: {
      id: string;
      email: string;
      emailVerified: boolean;
    }
  ): Promise<{ projectId: string; role: InvitationRole; alreadyMember: boolean }> {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      throw new NotFoundError("Invitation not found.");
    }

    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenError(
        "Please verify your email address before accepting a project invitation."
      );
    }

    const tokenHash = hashInviteToken(trimmed);
    const nowMs = this.now();
    const userEmail = authenticatedUser.email.trim().toLowerCase();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const match = await this.projects.findInvitationByTokenHash(
          tokenHash,
          tx
        );
        if (!match) {
          throw new NotFoundError("This invitation link is invalid.");
        }

        const { invitation } = match;
        const invitedEmail = invitation.email.trim().toLowerCase();

        if (userEmail !== invitedEmail) {
          throw new EmailMismatchError(
            `This invitation was sent to ${maskEmail(invitedEmail)}. You are signed in as ${authenticatedUser.email}.`
          );
        }

        if (invitation.status === "revoked" || invitation.status === "declined") {
          throw new ForbiddenError("This invitation is no longer active.");
        }

        if (invitation.status === "pending" && invitation.expiresAt <= nowMs) {
          await this.projects.updateInvitationStatus(
            invitation.id,
            invitation.projectId,
            "expired",
            tx
          );
          throw new ValidationError("This invitation link has expired.");
        }

        // Single atomic conditional claim: eliminates concurrent double-accept TOCTOU
        const claimed = await this.projects.claimPendingInvitation(
          invitation.id,
          invitation.projectId,
          nowMs,
          tx
        );
        if (!claimed) {
          throw new ConflictError(
            "This invitation has already been accepted or is no longer valid."
          );
        }

        await this.projects.addMember(
          {
            projectId: claimed.projectId,
            userId: authenticatedUser.id,
            role: claimed.role,
          },
          tx
        );

        await this.projects.recordActivity(
          {
            projectId: claimed.projectId,
            actorId: authenticatedUser.id,
            action: "member.joined",
            entityType: "member",
            entityId: authenticatedUser.id,
            metadata: { role: claimed.role },
          },
          tx
        );

        return {
          projectId: claimed.projectId,
          role: claimed.role,
          alreadyMember: false,
        };
      })
    );
  }

  async revokeInvitation(
    projectId: string,
    actorId: string,
    invitationId: string
  ): Promise<void> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup
    );

    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.projects.findInvitationById(
          invitationId,
          projectId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Invitation not found.");
        }
        if (existing.status !== "pending") {
          throw new ConflictError("Only pending invitations can be revoked.");
        }

        await this.projects.updateInvitationStatus(
          invitationId,
          projectId,
          "revoked",
          tx
        );
        await this.projects.recordActivity(
          {
            projectId,
            actorId,
            action: "invite.revoked",
            entityType: "invitation",
            entityId: invitationId,
            metadata: { recipient: maskEmail(existing.email) },
          },
          tx
        );
      })
    );
  }
}

export const projectInviteService = new ProjectInviteService();
