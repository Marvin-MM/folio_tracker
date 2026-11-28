import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projectActivities,
  projectInvitations,
  projectMembers,
  projects,
  reminders,
  tasks,
  users,
  type InvitationRole,
  type InvitationStatus,
  type ProjectActivityRecord,
  type ProjectInvitationRecord,
  type ProjectMemberRecord,
  type ProjectRecord,
  type ProjectRole,
  type ReminderRecord,
  type TaskStatus,
} from "@/server/db/schema";
import { parseNoteTags, type NoteWithReminders } from "./note-repository";
import type { TaskWithReminders } from "./task-repository";

export interface ProjectMemberWithUser {
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: number;
  name: string;
  email: string;
  image: string | null;
}

export interface ProjectActivityWithActor {
  activity: ProjectActivityRecord;
  actorName: string | null;
  actorEmail: string | null;
}

export interface ProjectTaskWithMeta extends TaskWithReminders {
  assigneeName: string | null;
}

export interface ProjectInvitationWithMeta {
  invitation: ProjectInvitationRecord;
  projectName: string;
  inviterName: string;
}

export interface SoleOwnedSharedProjectSummary {
  projectId: string;
  projectName: string;
  memberCount: number;
}

export interface ProjectRepository {
  createProject(
    input: {
      ownerId: string;
      name: string;
      description?: string | null;
      colorToken?: string;
    },
    executor?: DbExecutor
  ): Promise<ProjectRecord>;
  getProjectById(
    projectId: string,
    executor?: DbExecutor
  ): Promise<ProjectRecord | null>;
  updateProject(
    projectId: string,
    patch: {
      name?: string;
      description?: string | null;
      colorToken?: string;
      isArchived?: boolean;
    },
    executor?: DbExecutor
  ): Promise<ProjectRecord | null>;
  deleteProject(projectId: string, executor?: DbExecutor): Promise<boolean>;
  addMember(
    input: { projectId: string; userId: string; role: ProjectRole },
    executor?: DbExecutor
  ): Promise<ProjectMemberRecord | null>;
  getMember(
    projectId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<ProjectMemberRecord | null>;
  listMembersWithUsers(projectId: string): Promise<ProjectMemberWithUser[]>;
  listMemberUserIds(
    projectId: string,
    executor?: DbExecutor
  ): Promise<string[]>;
  listSoleOwnedSharedProjects(
    userId: string,
    executor?: DbExecutor
  ): Promise<SoleOwnedSharedProjectSummary[]>;
  reassignCoOwnedProjectsBeforeUserDeletion(
    userId: string,
    executor?: DbExecutor
  ): Promise<number>;
  findMemberByEmail(
    projectId: string,
    email: string,
    executor?: DbExecutor
  ): Promise<ProjectMemberRecord | null>;
  updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
    executor?: DbExecutor
  ): Promise<ProjectMemberRecord | null>;
  removeMember(
    projectId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  unassignMemberTasks(
    projectId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<number>;
  countMembers(projectId: string): Promise<number>;
  createInvitation(
    input: {
      projectId: string;
      invitedById: string;
      email: string;
      role: InvitationRole;
      tokenHash: string;
      expiresAt: number;
    },
    executor?: DbExecutor
  ): Promise<ProjectInvitationRecord>;
  findInvitationById(
    invitationId: string,
    projectId: string,
    executor?: DbExecutor
  ): Promise<ProjectInvitationRecord | null>;
  findInvitationByTokenHash(
    tokenHash: string,
    executor?: DbExecutor
  ): Promise<ProjectInvitationWithMeta | null>;
  findPendingInvitationByProjectAndEmail(
    projectId: string,
    email: string,
    executor?: DbExecutor
  ): Promise<ProjectInvitationRecord | null>;
  listPendingInvitationsForProject(
    projectId: string
  ): Promise<ProjectInvitationRecord[]>;
  updateInvitationStatus(
    invitationId: string,
    projectId: string,
    status: InvitationStatus,
    executor?: DbExecutor
  ): Promise<ProjectInvitationRecord | null>;
  claimPendingInvitation(
    invitationId: string,
    projectId: string,
    nowMs: number,
    executor?: DbExecutor
  ): Promise<ProjectInvitationRecord | null>;
  recordActivity(
    input: {
      projectId: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
    executor?: DbExecutor
  ): Promise<ProjectActivityRecord>;
  listActivitiesForProject(
    projectId: string,
    limit?: number
  ): Promise<ProjectActivityWithActor[]>;
  listProjectTasksWithReminders(
    projectId: string,
    viewerUserId: string,
    filters?: { assigneeId?: string | "unassigned"; status?: TaskStatus | "active" }
  ): Promise<{ items: ProjectTaskWithMeta[]; referenceUtcMs: number }>;
  listProjectNotesWithReminders(
    projectId: string,
    viewerUserId: string
  ): Promise<NoteWithReminders[]>;
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async createProject(
    input: {
      ownerId: string;
      name: string;
      description?: string | null;
      colorToken?: string;
    },
    executor: DbExecutor = this.database
  ): Promise<ProjectRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(projects)
      .values({
        ownerId: input.ownerId,
        name: input.name,
        description: input.description ?? null,
        colorToken: input.colorToken ?? "collab",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) throw new Error("Failed to create project.");
    return created;
  }

  async getProjectById(
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectRecord | null> {
    const [row] = await executor
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row ?? null;
  }

  async updateProject(
    projectId: string,
    patch: {
      name?: string;
      description?: string | null;
      colorToken?: string;
      isArchived?: boolean;
    },
    executor: DbExecutor = this.database
  ): Promise<ProjectRecord | null> {
    const [updated] = await executor
      .update(projects)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(eq(projects.id, projectId))
      .returning();
    return updated ?? null;
  }

  async deleteProject(
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(projects)
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    return deleted.length > 0;
  }

  async addMember(
    input: { projectId: string; userId: string; role: ProjectRole },
    executor: DbExecutor = this.database
  ): Promise<ProjectMemberRecord | null> {
    const [inserted] = await executor
      .insert(projectMembers)
      .values({
        projectId: input.projectId,
        userId: input.userId,
        role: input.role,
        joinedAt: Date.now(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) return inserted;
    return this.getMember(input.projectId, input.userId, executor);
  }

  async getMember(
    projectId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectMemberRecord | null> {
    const [row] = await executor
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listMembersWithUsers(
    projectId: string
  ): Promise<ProjectMemberWithUser[]> {
    return this.database
      .select({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        joinedAt: projectMembers.joinedAt,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.joinedAt));
  }

  async listMemberUserIds(
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<string[]> {
    const rows = await executor
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    return rows.map((r) => r.userId);
  }

  /**
   * Finds any project where `userId` is the sole `owner` AND at least one other
   * member exists. Used by `AccountService.deleteAccount()` to prevent orphaning
   * or silently destroying active shared projects.
   */
  async listSoleOwnedSharedProjects(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<SoleOwnedSharedProjectSummary[]> {
    const ownedRows = await executor
      .select({
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, "owner")
        )
      );

    if (ownedRows.length === 0) return [];

    const ownedIds = ownedRows.map((r) => r.projectId);
    const allMembers = await executor
      .select({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(inArray(projectMembers.projectId, ownedIds));

    const byProject = new Map<
      string,
      { total: number; otherOwners: number }
    >();
    for (const m of allMembers) {
      const entry = byProject.get(m.projectId) ?? { total: 0, otherOwners: 0 };
      entry.total += 1;
      if (m.role === "owner" && m.userId !== userId) {
        entry.otherOwners += 1;
      }
      byProject.set(m.projectId, entry);
    }

    const blocked: SoleOwnedSharedProjectSummary[] = [];
    for (const row of ownedRows) {
      const stats = byProject.get(row.projectId);
      if (stats && stats.total > 1 && stats.otherOwners === 0) {
        blocked.push({
          projectId: row.projectId,
          projectName: row.projectName,
          memberCount: stats.total,
        });
      }
    }

    return blocked;
  }

  async reassignCoOwnedProjectsBeforeUserDeletion(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<number> {
    const ownedProjects = await executor
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, userId));

    if (ownedProjects.length === 0) return 0;

    const projectIds = ownedProjects.map((p) => p.id);
    const otherOwners = await executor
      .select({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
      })
      .from(projectMembers)
      .where(
        and(
          inArray(projectMembers.projectId, projectIds),
          eq(projectMembers.role, "owner")
        )
      )
      .orderBy(asc(projectMembers.joinedAt));

    const replacementByProject = new Map<string, string>();
    for (const row of otherOwners) {
      if (row.userId !== userId && !replacementByProject.has(row.projectId)) {
        replacementByProject.set(row.projectId, row.userId);
      }
    }

    let reassigned = 0;
    const now = Date.now();
    for (const [projectId, nextOwnerId] of replacementByProject) {
      await executor
        .update(projects)
        .set({ ownerId: nextOwnerId, updatedAt: now })
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
      reassigned += 1;
    }

    return reassigned;
  }

  async findMemberByEmail(
    projectId: string,
    email: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectMemberRecord | null> {
    const normalized = email.trim().toLowerCase();
    const [row] = await executor
      .select({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        joinedAt: projectMembers.joinedAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(users.email, normalized)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
    executor: DbExecutor = this.database
  ): Promise<ProjectMemberRecord | null> {
    const [updated] = await executor
      .update(projectMembers)
      .set({ role })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .returning();
    return updated ?? null;
  }

  async removeMember(
    projectId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .returning({ userId: projectMembers.userId });
    return deleted.length > 0;
  }

  async unassignMemberTasks(
    projectId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<number> {
    const updated = await executor
      .update(tasks)
      .set({ assigneeId: null, updatedAt: Date.now() })
      .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, userId)))
      .returning({ id: tasks.id });
    return updated.length;
  }

  async countMembers(projectId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    return row?.value ?? 0;
  }

  async createInvitation(
    input: {
      projectId: string;
      invitedById: string;
      email: string;
      role: InvitationRole;
      tokenHash: string;
      expiresAt: number;
    },
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationRecord> {
    const [created] = await executor
      .insert(projectInvitations)
      .values({
        projectId: input.projectId,
        invitedById: input.invitedById,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        tokenHash: input.tokenHash,
        status: "pending",
        expiresAt: input.expiresAt,
        createdAt: Date.now(),
      })
      .returning();

    if (!created) throw new Error("Failed to create project invitation.");
    return created;
  }

  async findInvitationById(
    invitationId: string,
    projectId: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationRecord | null> {
    const [row] = await executor
      .select()
      .from(projectInvitations)
      .where(
        and(
          eq(projectInvitations.id, invitationId),
          eq(projectInvitations.projectId, projectId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async findInvitationByTokenHash(
    tokenHash: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationWithMeta | null> {
    const [row] = await executor
      .select({
        invitation: projectInvitations,
        projectName: projects.name,
        inviterName: users.name,
      })
      .from(projectInvitations)
      .innerJoin(projects, eq(projectInvitations.projectId, projects.id))
      .innerJoin(users, eq(projectInvitations.invitedById, users.id))
      .where(eq(projectInvitations.tokenHash, tokenHash))
      .limit(1);

    return row ?? null;
  }

  async findPendingInvitationByProjectAndEmail(
    projectId: string,
    email: string,
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationRecord | null> {
    const normalized = email.trim().toLowerCase();
    const [row] = await executor
      .select()
      .from(projectInvitations)
      .where(
        and(
          eq(projectInvitations.projectId, projectId),
          eq(projectInvitations.email, normalized),
          eq(projectInvitations.status, "pending")
        )
      )
      .limit(1);
    return row ?? null;
  }

  async listPendingInvitationsForProject(
    projectId: string
  ): Promise<ProjectInvitationRecord[]> {
    return this.database
      .select()
      .from(projectInvitations)
      .where(
        and(
          eq(projectInvitations.projectId, projectId),
          eq(projectInvitations.status, "pending")
        )
      )
      .orderBy(desc(projectInvitations.createdAt));
  }

  async updateInvitationStatus(
    invitationId: string,
    projectId: string,
    status: InvitationStatus,
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationRecord | null> {
    const [updated] = await executor
      .update(projectInvitations)
      .set({ status })
      .where(
        and(
          eq(projectInvitations.id, invitationId),
          eq(projectInvitations.projectId, projectId)
        )
      )
      .returning();
    return updated ?? null;
  }

  /**
   * Single atomic conditional UPDATE consuming a pending, unexpired invitation.
   * Eliminates TOCTOU double-accept races: strictly ONE concurrent caller gets a row back.
   */
  async claimPendingInvitation(
    invitationId: string,
    projectId: string,
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<ProjectInvitationRecord | null> {
    const [claimed] = await executor
      .update(projectInvitations)
      .set({ status: "accepted" })
      .where(
        and(
          eq(projectInvitations.id, invitationId),
          eq(projectInvitations.projectId, projectId),
          eq(projectInvitations.status, "pending"),
          gt(projectInvitations.expiresAt, nowMs)
        )
      )
      .returning();
    return claimed ?? null;
  }

  async recordActivity(
    input: {
      projectId: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
    executor: DbExecutor = this.database
  ): Promise<ProjectActivityRecord> {
    const [created] = await executor
      .insert(projectActivities)
      .values({
        projectId: input.projectId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt: Date.now(),
      })
      .returning();

    if (!created) throw new Error("Failed to insert project activity.");
    return created;
  }

  async listActivitiesForProject(
    projectId: string,
    limit = 60
  ): Promise<ProjectActivityWithActor[]> {
    return this.database
      .select({
        activity: projectActivities,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(projectActivities)
      .leftJoin(users, eq(projectActivities.actorId, users.id))
      .where(eq(projectActivities.projectId, projectId))
      .orderBy(desc(projectActivities.createdAt))
      .limit(limit);
  }

  async listProjectTasksWithReminders(
    projectId: string,
    viewerUserId: string,
    filters: { assigneeId?: string | "unassigned"; status?: TaskStatus | "active" } = {}
  ): Promise<{ items: ProjectTaskWithMeta[]; referenceUtcMs: number }> {
    const referenceUtcMs = Date.now();
    const project = await this.getProjectById(projectId);
    const rows = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.position), asc(tasks.id))
      .limit(200);

    const filteredRows = rows.filter((row) => {
      if (filters.status === "active") {
        if (row.status === "done" || row.status === "archived") return false;
      } else if (filters.status && row.status !== filters.status) {
        return false;
      } else if (!filters.status && row.status === "archived") {
        return false;
      }

      if (filters.assigneeId === "unassigned") {
        if (row.assigneeId !== null) return false;
      } else if (filters.assigneeId && row.assigneeId !== filters.assigneeId) {
        return false;
      }
      return true;
    });

    if (filteredRows.length === 0) {
      return { items: [], referenceUtcMs };
    }

    const taskIds = filteredRows.map((r) => r.id);
    const assigneeIds = Array.from(
      new Set(
        filteredRows
          .map((r) => r.assigneeId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const [reminderRows, assigneeRows] = await Promise.all([
      this.database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, viewerUserId),
            inArray(reminders.taskId, taskIds),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
          )
        )
        .orderBy(asc(reminders.remindAt), asc(reminders.id)),
      assigneeIds.length > 0
        ? this.database
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, assigneeIds))
        : Promise.resolve([]),
    ]);

    const remindersByTask = new Map<string, ReminderRecord[]>();
    for (const rem of reminderRows) {
      if (!rem.taskId) continue;
      const list = remindersByTask.get(rem.taskId) ?? [];
      list.push(rem);
      remindersByTask.set(rem.taskId, list);
    }

    const assigneeMap = new Map(assigneeRows.map((u) => [u.id, u.name]));

    return {
      referenceUtcMs,
      items: filteredRows.map((task) => ({
        task,
        projectName: project?.name ?? null,
        projectColorToken: project?.colorToken ?? null,
        assigneeName: task.assigneeId
          ? (assigneeMap.get(task.assigneeId) ?? null)
          : null,
        reminders: remindersByTask.get(task.id) ?? [],
      })),
    };
  }

  async listProjectNotesWithReminders(
    projectId: string,
    viewerUserId: string
  ): Promise<NoteWithReminders[]> {
    const project = await this.getProjectById(projectId);
    const rows = await this.database
      .select()
      .from(notes)
      .where(eq(notes.projectId, projectId))
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt), asc(notes.id))
      .limit(150);

    if (rows.length === 0) return [];

    const noteIds = rows.map((n) => n.id);
    const reminderRows = await this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, viewerUserId),
          inArray(reminders.noteId, noteIds),
          inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
        )
      )
      .orderBy(asc(reminders.remindAt), asc(reminders.id));

    const remindersByNote = new Map<string, ReminderRecord[]>();
    for (const rem of reminderRows) {
      if (!rem.noteId) continue;
      const list = remindersByNote.get(rem.noteId) ?? [];
      list.push(rem);
      remindersByNote.set(rem.noteId, list);
    }

    return rows.map((note) => ({
      note,
      tags: parseNoteTags(note.tagsJson),
      projectName: project?.name ?? null,
      projectColorToken: project?.colorToken ?? null,
      reminders: remindersByNote.get(note.id) ?? [],
    }));
  }
}

export const projectRepository: ProjectRepository =
  new DrizzleProjectRepository(db);
