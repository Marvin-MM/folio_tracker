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
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type {
  InvitationRole,
  ProjectInvitationRecord,
  ProjectRecord,
  ProjectRole,
  TaskStatus,
} from "@/server/db/schema";
import { defaultEventBus, type EventBus } from "@/server/providers/event-bus";
import {
  buildCancelledReminderEvent,
  ReminderService,
} from "./reminder-service";

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
  reminders?: ReminderRepository;
  membershipLookup?: ProjectMembershipLookup;
  eventBus?: EventBus;
}

export class ProjectService {
  private readonly database: AppDatabase;
  private readonly projects: ProjectRepository;
  private readonly reminders: ReminderRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly reminderService: ReminderService;

  constructor(deps: ProjectServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.projects = deps.projects ?? projectRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.reminderService = new ReminderService({
      database: this.database,
      reminders: this.reminders,
      eventBus: deps.eventBus ?? defaultEventBus,
    });
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

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
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
      })
    );
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
      this.membershipLookup
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
      this.membershipLookup
    );

    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ValidationError("Project name cannot be empty.");
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
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
      })
    );
  }

  async deleteProject(projectId: string, actorId: string): Promise<void> {
    await assertProjectRole(
      projectId,
      actorId,
      ["owner"],
      this.membershipLookup
    );

    const cancelledEvents = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        // Collect ALL active scheduled reminders on tasks/notes in this project BEFORE cascade delete
        const activeScheduled =
          await this.reminders.findActiveScheduledForProject(projectId, tx);

        const deleted = await this.projects.deleteProject(projectId, tx);
        if (!deleted) {
          throw new NotFoundError("Project not found.");
        }

        return activeScheduled.map((row) =>
          buildCancelledReminderEvent({
            reminderId: row.id,
            userId: row.userId,
            version: row.version,
          })
        );
      })
    );

    if (cancelledEvents.length > 0) {
      await this.reminderService.emitControlEventsSafely(cancelledEvents);
    }
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
      this.membershipLookup
    );

    if (actorId === targetUserId) {
      throw new ForbiddenError("Project owners cannot demote themselves.");
    }

    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.projects.getMember(
          projectId,
          targetUserId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Project member not found.");
        }
        if (existing.role === "owner") {
          throw new ForbiddenError("Cannot modify another owner's role.");
        }

        await this.projects.updateMemberRole(
          projectId,
          targetUserId,
          nextRole,
          tx
        );
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
      })
    );
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
      this.membershipLookup
    );

    if (actorId === targetUserId) {
      throw new ForbiddenError("Project owners cannot remove themselves.");
    }

    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.projects.getMember(
          projectId,
          targetUserId,
          tx
        );
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
      })
    );
  }
}

export const projectService = new ProjectService();
