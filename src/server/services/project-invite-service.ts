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
import { db, type AppDatabase } from "@/server/db";
import type {
  InvitationRole,
  ProjectInvitationRecord,
} from "@/server/db/schema";
import {
  defaultEventBus,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultPermissionCache,
  type PermissionCache,
} from "@/server/providers/redis/permission-cache";
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
      invitedEmailNormalized: string;
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
  permissionCache?: PermissionCache;
  rateLimiter?: RateLimiter;
  eventBus?: EventBus;
  now?: () => number;
}

export class ProjectInviteService {
  private readonly database: AppDatabase;
  private readonly projects: ProjectRepository;
  private readonly users: UserRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly permissionCache: PermissionCache;
  private readonly rateLimiter: RateLimiter;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: ProjectInviteServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.projects = deps.projects ?? projectRepository;
    this.users = deps.users ?? userRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.permissionCache = deps.permissionCache ?? defaultPermissionCache;
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
      this.membershipLookup,
      this.permissionCache
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

    const { invitation, projectName, inviterName } =
      await this.database.transaction(async (tx) => {
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

        const inviter = await this.users.getById(actorId);

        return {
          invitation: created,
          projectName: project.name,
          inviterName: inviter?.name ?? "A project owner",
        };
      });

    const invitePath = `/invite/${rawToken}`;
    const baseUrl =
      process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";

    await this.eventBus.emit({
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

    return { invitation, invitePath };
  }

  async previewInvitationByToken(
    rawToken: string
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

    return {
      status: "valid",
      projectId: invitation.projectId,
      projectName,
      inviterName,
      role: invitation.role,
      invitedEmailMasked: maskEmail(invitation.email),
      invitedEmailNormalized: invitation.email.trim().toLowerCase(),
      expiresAt: invitation.expiresAt,
    };
  }

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

    const outcome = await this.database.transaction(async (tx) => {
      const match = await this.projects.findInvitationByTokenHash(tokenHash, tx);
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

      // Idempotent handling if already accepted by this exact user
      if (invitation.status === "accepted") {
        const existingMember = await this.projects.getMember(
          invitation.projectId,
          authenticatedUser.id,
          tx
        );
        if (existingMember) {
          return {
            projectId: invitation.projectId,
            role: invitation.role,
            alreadyMember: true,
          };
        }
        throw new ConflictError("This invitation has already been used.");
      }

      if (invitation.status === "revoked" || invitation.status === "declined") {
        throw new ForbiddenError("This invitation is no longer active.");
      }

      if (invitation.expiresAt <= nowMs) {
        await this.projects.updateInvitationStatus(
          invitation.id,
          "expired",
          tx
        );
        throw new ValidationError("This invitation link has expired.");
      }

      const claimed = await this.projects.claimPendingInvitation(
        invitation.id,
        tx
      );
      if (!claimed) {
        throw new ConflictError("This invitation has already been accepted.");
      }

      await this.projects.addMember(
        {
          projectId: invitation.projectId,
          userId: authenticatedUser.id,
          role: invitation.role,
        },
        tx
      );

      await this.projects.recordActivity(
        {
          projectId: invitation.projectId,
          actorId: authenticatedUser.id,
          action: "member.joined",
          entityType: "member",
          entityId: authenticatedUser.id,
          metadata: { role: invitation.role },
        },
        tx
      );

      return {
        projectId: invitation.projectId,
        role: invitation.role,
        alreadyMember: false,
      };
    });

    // Immediately invalidate any cached non-member/prior role entry
    await this.permissionCache.invalidateRole(
      outcome.projectId,
      authenticatedUser.id
    );

    return outcome;
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
      this.membershipLookup,
      this.permissionCache
    );

    await this.database.transaction(async (tx) => {
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

      await this.projects.updateInvitationStatus(invitationId, "revoked", tx);
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
    });
  }
}

export const projectInviteService = new ProjectInviteService();
