import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import type { NoteWithReminders } from "@/server/dal/note-repository";
import {
  projectRepository,
  type ProjectActivityWithActor,
  type ProjectMemberWithUser,
  type ProjectRepository,
  type ProjectTaskWithMeta,
} from "@/server/dal/project-repository";
import { db, type AppDatabase } from "@/server/db";
import type {
  InvitationRole,
  ProjectInvitationRecord,
  ProjectRecord,
  ProjectRole,
  TaskStatus,
} from "@/server/db/schema";
import {
  defaultPermissionCache,
  type PermissionCache,
} from "@/server/providers/redis/permission-cache";

export const PROJECT_COLOR_TOKENS = [
  "collab",
  "reminder",
  "done",
  "overdue",
] as const;
export type ProjectColorToken = (typeof PROJECT_COLOR_TOKENS)[number];

export interface ProjectWorkspaceData {
  project: ProjectRecord;
  viewerRole: ProjectRole;
  members: ProjectMemberWithUser[];
  pendingInvitations: ProjectInvitationRecord[];
  tasks: ProjectTaskWithMeta[];
  notes: NoteWithReminders[];
  activities: ProjectActivityWithActor[];
  referenceUtcMs: number;
}

export interface ProjectServiceDeps {
  database?: AppDatabase;
  projects?: ProjectRepository;
  membershipLookup?: ProjectMembershipLookup;
  permissionCache?: PermissionCache;
}

export class ProjectService {
  private readonly database: AppDatabase;
  private readonly projects: ProjectRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly permissionCache: PermissionCache;

  constructor(deps: ProjectServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.projects = deps.projects ?? projectRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.permissionCache = deps.permissionCache ?? defaultPermissionCache;
  }

  async createProject(
    ownerId: string,
    input: {
      name: string;
      description?: string | null;
      colorToken?: ProjectColorToken;
    }
  ): Promise<ProjectRecord> {
    const name = input.name.trim();
    if (!name) {
      throw new ValidationError("Project name is required.");
    }

    const created = await this.database.transaction(async (tx) => {
      const project = await this.projects.createProject(
        {
          ownerId,
          name,
          description: input.description?.trim() || null,
          colorToken: input.colorToken ?? "collab",
        },
        tx
      );

      await this.projects.addMember(
        { projectId: project.id, userId: ownerId, role: "owner" },
        tx
      );

      await this.projects.recordActivity(
        {
          projectId: project.id,
          actorId: ownerId,
          action: "project.created",
          entityType: "project",
          entityId: project.id,
          metadata: { name: project.name },
        },
        tx
      );

      return project;
    });

    await this.permissionCache.setRole(created.id, ownerId, "owner");
    return created;
  }

  async getProjectWorkspace(
    projectId: string,
    userId: string,
    filters: { assigneeId?: string | "unassigned"; status?: TaskStatus | "active" } = {}
  ): Promise<ProjectWorkspaceData> {
    const membership = await assertProjectRole(
      projectId,
      userId,
      ["owner", "editor", "viewer"],
      this.membershipLookup,
      this.permissionCache
    );

    const project = await this.projects.getProjectById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    const [members, pendingInvitations, taskQuery, projectNotes, activities] =
      await Promise.all([
        this.projects.listMembersWithUsers(projectId),
        membership.role === "owner"
          ? this.projects.listPendingInvitationsForProject(projectId)
          : Promise.resolve([]),
        this.projects.listProjectTasksWithReminders(projectId, userId, filters),
        this.projects.listProjectNotesWithReminders(projectId, userId),
        this.projects.listActivitiesForProject(projectId, 60),
      ]);

    return {
      project,
      viewerRole: membership.role,
      members,
      pendingInvitations,
      tasks: taskQuery.items,
      notes: projectNotes,
      activities,
      referenceUtcMs: taskQuery.referenceUtcMs,
    };
  }

  async updateProject(
    projectId: string,
    actorId: string,
    patch: {
      name?: string;
      description?: string | null;
      colorToken?: ProjectColorToken;
      isArchived?: boolean;
    }
  ): Promise<ProjectRecord> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup,
      this.permissionCache
    );

    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ValidationError("Project name cannot be empty.");
    }

    return this.database.transaction(async (tx) => {
      const updated = await this.projects.updateProject(
        projectId,
        {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description?.trim() || null }
            : {}),
          ...(patch.colorToken !== undefined
            ? { colorToken: patch.colorToken }
            : {}),
          ...(patch.isArchived !== undefined
            ? { isArchived: patch.isArchived }
            : {}),
        },
        tx
      );

      if (!updated) {
        throw new NotFoundError("Project not found.");
      }

      await this.projects.recordActivity(
        {
          projectId,
          actorId,
          action: patch.isArchived ? "project.archived" : "project.updated",
          entityType: "project",
          entityId: projectId,
          metadata: { name: updated.name },
        },
        tx
      );

      return updated;
    });
  }

  async deleteProject(projectId: string, actorId: string): Promise<void> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup,
      this.permissionCache
    );

    const memberIds = await this.database.transaction(async (tx) => {
      const ids = await this.projects.listMemberUserIds(projectId, tx);
      const deleted = await this.projects.deleteProject(projectId, tx);
      if (!deleted) {
        throw new NotFoundError("Project not found.");
      }
      return ids;
    });

    await Promise.all(
      memberIds.map((uid) => this.permissionCache.invalidateRole(projectId, uid))
    );
  }

  async updateMemberRole(
    projectId: string,
    actorId: string,
    targetUserId: string,
    nextRole: InvitationRole
  ): Promise<void> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup,
      this.permissionCache
    );

    if (actorId === targetUserId) {
      throw new ForbiddenError("Project owners cannot demote themselves.");
    }

    await this.database.transaction(async (tx) => {
      const existing = await this.projects.getMember(projectId, targetUserId, tx);
      if (!existing) {
        throw new NotFoundError("Project member not found.");
      }
      if (existing.role === "owner") {
        throw new ForbiddenError("Cannot modify another owner's role.");
      }

      await this.projects.updateMemberRole(projectId, targetUserId, nextRole, tx);
      await this.projects.recordActivity(
        {
          projectId,
          actorId,
          action: "member.role_updated",
          entityType: "member",
          entityId: targetUserId,
          metadata: { previousRole: existing.role, nextRole },
        },
        tx
      );
    });

    // Immediately invalidate cached RBAC role after commit
    await this.permissionCache.invalidateRole(projectId, targetUserId);
  }

  async removeMember(
    projectId: string,
    actorId: string,
    targetUserId: string
  ): Promise<void> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup,
      this.permissionCache
    );

    if (actorId === targetUserId) {
      throw new ForbiddenError("Project owners cannot remove themselves.");
    }

    await this.database.transaction(async (tx) => {
      const existing = await this.projects.getMember(projectId, targetUserId, tx);
      if (!existing) {
        throw new NotFoundError("Project member not found.");
      }
      if (existing.role === "owner") {
        throw new ForbiddenError("Cannot remove a project owner.");
      }

      await this.projects.unassignMemberTasks(projectId, targetUserId, tx);
      await this.projects.removeMember(projectId, targetUserId, tx);
      await this.projects.recordActivity(
        {
          projectId,
          actorId,
          action: "member.removed",
          entityType: "member",
          entityId: targetUserId,
          metadata: { removedRole: existing.role },
        },
        tx
      );
    });

    // Immediately invalidate cached RBAC role after commit
    await this.permissionCache.invalidateRole(projectId, targetUserId);
  }
}

export const projectService = new ProjectService();
