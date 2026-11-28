import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  accounts,
  adminAuditLogs,
  habitComments,
  habitLogs,
  habitMonitorRequests,
  habitMonitors,
  habitReactions,
  habits,
  notes,
  notifications,
  operationInvitations,
  projectActivities,
  projectInvitations,
  projectMembers,
  projects,
  pushSubscriptions,
  reminders,
  sessions,
  tasks,
  users,
  verifications,
  type AdminAuditLogRecord,
  type AdminAuditTargetType,
  type UserRole,
} from "@/server/db/schema";

export interface PlatformKpis {
  users: {
    total: number;
    verified: number;
    admins: number;
    suspended: number;
    new7d: number;
    new30d: number;
    activeSessions: number;
  };
  workspace: {
    tasksTotal: number;
    tasksActive: number;
    tasksCompleted: number;
    tasksCompleted7d: number;
    notesTotal: number;
    notesPinned: number;
    projectsTotal: number;
    sharedProjects: number;
    pendingProjectInvites: number;
  };
  habits: {
    activeHabits: number;
    archivedHabits: number;
    logs7d: number;
    lateBackfills7d: number;
    activeCirclePairs: number;
    pendingMonitorRequests: number;
    cycleCommentsTotal: number;
    cycleReactionsTotal: number;
  };
  delivery: {
    remindersScheduled: number;
    remindersPendingFar: number;
    remindersSent: number;
    remindersSent7d: number;
    remindersSnoozed: number;
    remindersCancelled: number;
    undispatchedOutboxBacklog: number;
    pushSubscriptions: number;
    unreadNotifications: number;
  };
  adoption: {
    googleAccounts: number;
    credentialAccounts: number;
    cadenceDaily: number;
    cadenceSpecificDays: number;
    cadenceWeeklyTarget: number;
  };
}

export interface DailyPlatformMetricPoint {
  dateKey: string;
  label: string;
  newUsers: number;
  tasksCreated: number;
  tasksCompleted: number;
  habitLogs: number;
  remindersSent: number;
}

export interface AdminUserDirectoryItem {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  isSuspended: boolean;
  timezone: string;
  createdAtMs: number;
  providers: string[];
  activeSessions: number;
  tasksCount: number;
  notesCount: number;
  habitsCount: number;
  projectsCount: number;
}

export interface AdminUsersDirectoryPage {
  items: AdminUserDirectoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type PlatformTimelineCategory =
  | "all"
  | "audit"
  | "project"
  | "user"
  | "reminder";

export interface PlatformTimelineEvent {
  id: string;
  category: Exclude<PlatformTimelineCategory, "all">;
  tone: "neutral" | "done" | "reminder" | "collab" | "overdue";
  action: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  badgeLabel: string;
  createdAtMs: number;
}

export interface SweepExpiredSummary {
  expiredProjectInvitations: number;
  expiredHabitRequests: number;
  expiredOperationInvitations: number;
  prunedSessions: number;
  prunedVerifications: number;
}

export interface AdminUserDirectoryFilter {
  query?: string;
  roleFilter?: "all" | "admin" | "user";
  statusFilter?: "all" | "active" | "suspended" | "unverified";
  page?: number;
  pageSize?: number;
}

export interface AdminRepository {
  getPlatformKpis(nowMs: number): Promise<PlatformKpis>;
  getDailyPlatformSeries(
    days: number,
    nowMs: number
  ): Promise<DailyPlatformMetricPoint[]>;
  listUsersDirectory(
    filter: AdminUserDirectoryFilter,
    nowMs: number
  ): Promise<AdminUsersDirectoryPage>;
  listPlatformTimeline(
    category: PlatformTimelineCategory,
    limit?: number
  ): Promise<PlatformTimelineEvent[]>;
  getUserForAdminAction(
    userId: string,
    executor?: DbExecutor
  ): Promise<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isSuspended: boolean;
    emailVerified: boolean;
  } | null>;
  recordAuditLog(
    input: {
      actorUserId: string | null;
      action: string;
      targetType: AdminAuditTargetType;
      targetId?: string | null;
      metadata?: Record<string, unknown>;
    },
    executor?: DbExecutor
  ): Promise<AdminAuditLogRecord>;
  revokeUserSessions(userId: string, executor?: DbExecutor): Promise<number>;
  setUserSuspended(
    userId: string,
    suspended: boolean,
    executor?: DbExecutor
  ): Promise<boolean>;
  sweepExpiredRecords(
    nowMs: number,
    executor?: DbExecutor
  ): Promise<SweepExpiredSummary>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatUtcDateKey(ms: number): string {
  return formatInTimeZone(ms, "UTC", "yyyy-MM-dd");
}

function formatShortDayLabel(ms: number): string {
  return formatInTimeZone(ms, "UTC", "MMM d");
}

function parseMetaSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function describeAuditEvent(
  action: string,
  meta: Record<string, unknown>,
  actorName: string | null
): {
  title: string;
  detail: string | null;
  tone: PlatformTimelineEvent["tone"];
} {
  const actor = actorName ?? "System";
  switch (action) {
    case "admin.roles_synced": {
      const promoted = Number(meta.promotedCount ?? 0);
      const demoted = Number(meta.demotedCount ?? 0);
      return {
        title: `${actor} synced ADMIN_EMAILS roles`,
        detail: `${promoted} promoted · ${demoted} demoted (${Number(meta.configuredCount ?? 0)} configured)`,
        tone: "collab",
      };
    }
    case "admin.outbox_reconciled":
      return {
        title: `${actor} reconciled reminder outbox`,
        detail: `${Number(meta.reconciledCount ?? 0)} undispatched reminder(s) queued`,
        tone: "reminder",
      };
    case "admin.expired_swept":
      return {
        title: `${actor} swept expired platform records`,
        detail: `${Number(meta.expiredProjectInvitations ?? 0)} project invites · ${Number(meta.expiredHabitRequests ?? 0)} monitor requests · ${Number(meta.prunedSessions ?? 0)} sessions`,
        tone: "done",
      };
    case "admin.user_sessions_revoked":
      return {
        title: `${actor} revoked active sessions`,
        detail: `${Number(meta.revokedSessions ?? 0)} session(s) invalidated for ${typeof meta.targetEmail === "string" ? meta.targetEmail : "user"}`,
        tone: "reminder",
      };
    case "admin.user_suspended":
      return {
        title: `${actor} suspended user account`,
        detail:
          typeof meta.targetEmail === "string"
            ? `${meta.targetEmail} (${Number(meta.revokedSessions ?? 0)} sessions revoked)`
            : null,
        tone: "overdue",
      };
    case "admin.user_unsuspended":
      return {
        title: `${actor} restored suspended account`,
        detail:
          typeof meta.targetEmail === "string" ? meta.targetEmail : null,
        tone: "done",
      };
    default:
      return {
        title: `${actor} executed ${action}`,
        detail: null,
        tone: "neutral",
      };
  }
}

function normalizeProjectActionKey(rawAction: string): string {
  const trimmed = rawAction.trim();
  if (trimmed.includes(".")) return trimmed;
  const firstUnderscore = trimmed.indexOf("_");
  if (firstUnderscore === -1) return trimmed;
  return `${trimmed.slice(0, firstUnderscore)}.${trimmed.slice(firstUnderscore + 1)}`;
}

function describeSanitizedProjectActivity(
  action: string,
  actorName: string | null,
  projectName: string | null
): {
  title: string;
  tone: PlatformTimelineEvent["tone"];
} {
  const actor = actorName ?? "Member";
  const scope = projectName ? ` in ${projectName}` : "";
  const normalized = normalizeProjectActionKey(action);
  switch (normalized) {
    case "project.created":
      return { title: `${actor} created project${scope}`, tone: "collab" };
    case "project.updated":
      return { title: `${actor} updated project details${scope}`, tone: "collab" };
    case "project.archived":
      return { title: `${actor} archived project${scope}`, tone: "overdue" };
    case "member.invited":
      return { title: `${actor} sent a project invitation${scope}`, tone: "collab" };
    case "invite.revoked":
      return { title: `${actor} revoked a project invitation${scope}`, tone: "overdue" };
    case "member.joined":
      return { title: `${actor} joined project${scope}`, tone: "done" };
    case "member.role_updated":
      return { title: `${actor} updated member role${scope}`, tone: "collab" };
    case "member.removed":
      return { title: `${actor} removed a project member${scope}`, tone: "overdue" };
    case "task.completed":
      return { title: `${actor} completed a project task${scope}`, tone: "done" };
    case "task.reopened":
      return { title: `${actor} reopened a project task${scope}`, tone: "neutral" };
    case "task.assigned":
      return { title: `${actor} updated task assignment${scope}`, tone: "collab" };
    case "task.updated":
      return { title: `${actor} updated a project task${scope}`, tone: "neutral" };
    case "task.deleted":
      return { title: `${actor} deleted a project task${scope}`, tone: "overdue" };
    case "task.created":
      return { title: `${actor} added a project task${scope}`, tone: "neutral" };
    case "note.created":
      return { title: `${actor} created a project note${scope}`, tone: "neutral" };
    case "note.updated":
      return { title: `${actor} edited a project note${scope}`, tone: "neutral" };
    case "note.deleted":
      return { title: `${actor} deleted a project note${scope}`, tone: "overdue" };
    default:
      return {
        title: `${actor} updated project activity${scope}`,
        tone: "neutral",
      };
  }
}

export class DrizzleAdminRepository implements AdminRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async getPlatformKpis(nowMs: number): Promise<PlatformKpis> {
    const sevenDaysAgoDate = new Date(nowMs - 7 * DAY_MS);
    const thirtyDaysAgoDate = new Date(nowMs - 30 * DAY_MS);
    const sevenDaysAgoMs = nowMs - 7 * DAY_MS;
    const outboxCutoffMs = nowMs - 60_000;
    const nowDate = new Date(nowMs);

    // Single pipelined HTTP batch to Turso (1 round-trip instead of 20!)
    const [
      userCounts,
      activeSessionsCount,
      taskCounts,
      noteCounts,
      projectCounts,
      sharedProjectRows,
      pendingInviteCount,
      habitCounts,
      habitLog7dCounts,
      activeCirclePairsRows,
      pendingMonitorReqRows,
      cycleCommentsRows,
      cycleReactionsRows,
      reminderStatusRows,
      remindersSent7dCount,
      outboxBacklogCount,
      pushSubsCount,
      unreadNotifCount,
      accountProviderRows,
      habitCadenceRows,
    ] = await this.database.batch([
      this.database
        .select({
          total: count(),
          verified: sql<number>`sum(case when ${users.emailVerified} = 1 then 1 else 0 end)`,
          admins: sql<number>`sum(case when ${users.role} = 'admin' then 1 else 0 end)`,
          suspended: sql<number>`sum(case when ${users.isSuspended} = 1 then 1 else 0 end)`,
          new7d: sql<number>`sum(case when ${users.createdAt} >= ${sevenDaysAgoDate.getTime()} then 1 else 0 end)`,
          new30d: sql<number>`sum(case when ${users.createdAt} >= ${thirtyDaysAgoDate.getTime()} then 1 else 0 end)`,
        })
        .from(users),
      this.database
        .select({ value: count() })
        .from(sessions)
        .where(gt(sessions.expiresAt, nowDate)),
      this.database
        .select({
          total: count(),
          active: sql<number>`sum(case when ${tasks.status} in ('todo', 'in_progress') then 1 else 0 end)`,
          completed: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
          completed7d: sql<number>`sum(case when ${tasks.status} = 'done' and ${tasks.completedAt} >= ${sevenDaysAgoMs} then 1 else 0 end)`,
        })
        .from(tasks),
      this.database
        .select({
          total: count(),
          pinned: sql<number>`sum(case when ${notes.isPinned} = 1 then 1 else 0 end)`,
        })
        .from(notes),
      this.database.select({ total: count() }).from(projects),
      this.database
        .select({
          projectId: projectMembers.projectId,
        })
        .from(projectMembers)
        .groupBy(projectMembers.projectId)
        .having(sql`count(*) > 1`),
      this.database
        .select({ value: count() })
        .from(projectInvitations)
        .where(
          and(
            eq(projectInvitations.status, "pending"),
            gt(projectInvitations.expiresAt, nowMs)
          )
        ),
      this.database
        .select({
          active: sql<number>`sum(case when ${habits.isArchived} = 0 then 1 else 0 end)`,
          archived: sql<number>`sum(case when ${habits.isArchived} = 1 then 1 else 0 end)`,
        })
        .from(habits),
      this.database
        .select({
          total7d: count(),
          lateBackfills7d: sql<number>`sum(case when ${habitLogs.isBackfilledLate} = 1 then 1 else 0 end)`,
        })
        .from(habitLogs)
        .where(gte(habitLogs.loggedAt, sevenDaysAgoMs)),
      this.database
        .select({ value: count() })
        .from(habitMonitors)
        .where(eq(habitMonitors.status, "active")),
      this.database
        .select({ value: count() })
        .from(habitMonitorRequests)
        .where(
          and(
            eq(habitMonitorRequests.status, "pending"),
            gt(habitMonitorRequests.expiresAt, nowMs)
          )
        ),
      this.database.select({ value: count() }).from(habitComments),
      this.database.select({ value: count() }).from(habitReactions),
      this.database
        .select({
          status: reminders.status,
          total: count(),
        })
        .from(reminders)
        .groupBy(reminders.status),
      this.database
        .select({ value: count() })
        .from(reminders)
        .where(
          and(
            eq(reminders.status, "sent"),
            gte(reminders.sentAt, sevenDaysAgoMs)
          )
        ),
      this.database
        .select({ value: count() })
        .from(reminders)
        .where(
          and(
            eq(reminders.status, "scheduled"),
            isNull(reminders.dispatchedAt),
            lte(reminders.updatedAt, outboxCutoffMs)
          )
        ),
      this.database.select({ value: count() }).from(pushSubscriptions),
      this.database
        .select({ value: count() })
        .from(notifications)
        .where(eq(notifications.isRead, false)),
      this.database
        .select({
          providerId: accounts.providerId,
          total: count(),
        })
        .from(accounts)
        .groupBy(accounts.providerId),
      this.database
        .select({
          cadenceType: habits.cadenceType,
          total: count(),
        })
        .from(habits)
        .where(eq(habits.isArchived, false))
        .groupBy(habits.cadenceType),
    ]);

    const u = userCounts[0];
    const t = taskCounts[0];
    const n = noteCounts[0];
    const h = habitCounts[0];
    const hl = habitLog7dCounts[0];

    const reminderByStatus = new Map(
      reminderStatusRows.map((row) => [row.status, Number(row.total)])
    );
    const providersByName = new Map(
      accountProviderRows.map((row) => [row.providerId, Number(row.total)])
    );
    const cadenceByType = new Map(
      habitCadenceRows.map((row) => [row.cadenceType, Number(row.total)])
    );

    const sharedProjects = sharedProjectRows.length;

    return {
      users: {
        total: Number(u?.total ?? 0),
        verified: Number(u?.verified ?? 0),
        admins: Number(u?.admins ?? 0),
        suspended: Number(u?.suspended ?? 0),
        new7d: Number(u?.new7d ?? 0),
        new30d: Number(u?.new30d ?? 0),
        activeSessions: Number(activeSessionsCount[0]?.value ?? 0),
      },
      workspace: {
        tasksTotal: Number(t?.total ?? 0),
        tasksActive: Number(t?.active ?? 0),
        tasksCompleted: Number(t?.completed ?? 0),
        tasksCompleted7d: Number(t?.completed7d ?? 0),
        notesTotal: Number(n?.total ?? 0),
        notesPinned: Number(n?.pinned ?? 0),
        projectsTotal: Number(projectCounts[0]?.total ?? 0),
        sharedProjects,
        pendingProjectInvites: Number(pendingInviteCount[0]?.value ?? 0),
      },
      habits: {
        activeHabits: Number(h?.active ?? 0),
        archivedHabits: Number(h?.archived ?? 0),
        logs7d: Number(hl?.total7d ?? 0),
        lateBackfills7d: Number(hl?.lateBackfills7d ?? 0),
        activeCirclePairs: Number(activeCirclePairsRows[0]?.value ?? 0),
        pendingMonitorRequests: Number(pendingMonitorReqRows[0]?.value ?? 0),
        cycleCommentsTotal: Number(cycleCommentsRows[0]?.value ?? 0),
        cycleReactionsTotal: Number(cycleReactionsRows[0]?.value ?? 0),
      },
      delivery: {
        remindersScheduled: reminderByStatus.get("scheduled") ?? 0,
        remindersPendingFar: reminderByStatus.get("pending_far") ?? 0,
        remindersSent: reminderByStatus.get("sent") ?? 0,
        remindersSent7d: Number(remindersSent7dCount[0]?.value ?? 0),
        remindersSnoozed: reminderByStatus.get("snoozed") ?? 0,
        remindersCancelled: reminderByStatus.get("cancelled") ?? 0,
        undispatchedOutboxBacklog: Number(outboxBacklogCount[0]?.value ?? 0),
        pushSubscriptions: Number(pushSubsCount[0]?.value ?? 0),
        unreadNotifications: Number(unreadNotifCount[0]?.value ?? 0),
      },
      adoption: {
        googleAccounts: providersByName.get("google") ?? 0,
        credentialAccounts: providersByName.get("credential") ?? 0,
        cadenceDaily: cadenceByType.get("daily") ?? 0,
        cadenceSpecificDays: cadenceByType.get("specific_days") ?? 0,
        cadenceWeeklyTarget: cadenceByType.get("weekly_target") ?? 0,
      },
    };
  }

  async getDailyPlatformSeries(
    days: number,
    nowMs: number
  ): Promise<DailyPlatformMetricPoint[]> {
    const safeDays = Math.min(30, Math.max(7, days));
    const startMs = nowMs - (safeDays - 1) * DAY_MS;
    const lowerBoundMs = startMs - DAY_MS;
    const startDate = new Date(lowerBoundMs);

    const bucketMap = new Map<string, DailyPlatformMetricPoint>();
    const orderedKeys: string[] = [];
    for (let i = safeDays - 1; i >= 0; i--) {
      const dayMs = nowMs - i * DAY_MS;
      const dateKey = formatUtcDateKey(dayMs);
      orderedKeys.push(dateKey);
      bucketMap.set(dateKey, {
        dateKey,
        label: formatShortDayLabel(dayMs),
        newUsers: 0,
        tasksCreated: 0,
        tasksCompleted: 0,
        habitLogs: 0,
        remindersSent: 0,
      });
    }

    const userDayExpr = sql<string>`strftime('%Y-%m-%d', ${users.createdAt} / 1000, 'unixepoch')`;
    const taskCreatedDayExpr = sql<string>`strftime('%Y-%m-%d', ${tasks.createdAt} / 1000, 'unixepoch')`;
    const taskCompletedDayExpr = sql<string>`strftime('%Y-%m-%d', ${tasks.completedAt} / 1000, 'unixepoch')`;
    const habitLogDayExpr = sql<string>`strftime('%Y-%m-%d', ${habitLogs.loggedAt} / 1000, 'unixepoch')`;
    const reminderSentDayExpr = sql<string>`strftime('%Y-%m-%d', ${reminders.sentAt} / 1000, 'unixepoch')`;

    // SQL GROUP BY + single db.batch() returns <= 16 tiny rows per metric
    // instead of downloading 8,000+ raw habit_logs rows over HTTP!
    const [userSeries, taskCreatedSeries, taskCompletedSeries, logSeries, sentSeries] =
      await this.database.batch([
        this.database
          .select({ day: userDayExpr, total: count() })
          .from(users)
          .where(gte(users.createdAt, startDate))
          .groupBy(userDayExpr),
        this.database
          .select({ day: taskCreatedDayExpr, total: count() })
          .from(tasks)
          .where(gte(tasks.createdAt, lowerBoundMs))
          .groupBy(taskCreatedDayExpr),
        this.database
          .select({ day: taskCompletedDayExpr, total: count() })
          .from(tasks)
          .where(
            and(
              eq(tasks.status, "done"),
              gte(tasks.completedAt, lowerBoundMs)
            )
          )
          .groupBy(taskCompletedDayExpr),
        this.database
          .select({ day: habitLogDayExpr, total: count() })
          .from(habitLogs)
          .where(gte(habitLogs.loggedAt, lowerBoundMs))
          .groupBy(habitLogDayExpr),
        this.database
          .select({ day: reminderSentDayExpr, total: count() })
          .from(reminders)
          .where(
            and(
              eq(reminders.status, "sent"),
              gte(reminders.sentAt, lowerBoundMs)
            )
          )
          .groupBy(reminderSentDayExpr),
      ]);

    for (const row of userSeries) {
      const bucket = row.day ? bucketMap.get(row.day) : undefined;
      if (bucket) bucket.newUsers += Number(row.total);
    }
    for (const row of taskCreatedSeries) {
      const bucket = row.day ? bucketMap.get(row.day) : undefined;
      if (bucket) bucket.tasksCreated += Number(row.total);
    }
    for (const row of taskCompletedSeries) {
      const bucket = row.day ? bucketMap.get(row.day) : undefined;
      if (bucket) bucket.tasksCompleted += Number(row.total);
    }
    for (const row of logSeries) {
      const bucket = row.day ? bucketMap.get(row.day) : undefined;
      if (bucket) bucket.habitLogs += Number(row.total);
    }
    for (const row of sentSeries) {
      const bucket = row.day ? bucketMap.get(row.day) : undefined;
      if (bucket) bucket.remindersSent += Number(row.total);
    }

    return orderedKeys.map((key) => bucketMap.get(key)!);
  }

  async listUsersDirectory(
    filter: AdminUserDirectoryFilter,
    nowMs: number
  ): Promise<AdminUsersDirectoryPage> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const q = filter.query?.trim().toLowerCase();
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(
          sql`lower(${users.name}) like ${pattern}`,
          sql`lower(${users.email}) like ${pattern}`
        )
      );
    }

    if (filter.roleFilter === "admin") {
      conditions.push(eq(users.role, "admin"));
    } else if (filter.roleFilter === "user") {
      conditions.push(eq(users.role, "user"));
    }

    if (filter.statusFilter === "suspended") {
      conditions.push(eq(users.isSuspended, true));
    } else if (filter.statusFilter === "unverified") {
      conditions.push(eq(users.emailVerified, false));
    } else if (filter.statusFilter === "active") {
      conditions.push(
        and(eq(users.isSuspended, false), eq(users.emailVerified, true))
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow, pageRows] = await this.database.batch([
      this.database
        .select({ value: count() })
        .from(users)
        .where(whereClause),
      this.database
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          role: users.role,
          isSuspended: users.isSuspended,
          timezone: users.timezone,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(whereClause)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    if (pageRows.length === 0) {
      return {
        items: [],
        total: Number(totalRow[0]?.value ?? 0),
        page,
        pageSize,
      };
    }

    const userIds = pageRows.map((u) => u.id);
    const nowDate = new Date(nowMs);

    const [
      providerRows,
      sessionRows,
      taskCounts,
      noteCounts,
      habitCounts,
      projectCounts,
    ] = await this.database.batch([
      this.database
        .select({ userId: accounts.userId, providerId: accounts.providerId })
        .from(accounts)
        .where(inArray(accounts.userId, userIds)),
      this.database
        .select({ userId: sessions.userId, total: count() })
        .from(sessions)
        .where(
          and(inArray(sessions.userId, userIds), gt(sessions.expiresAt, nowDate))
        )
        .groupBy(sessions.userId),
      this.database
        .select({ userId: tasks.userId, total: count() })
        .from(tasks)
        .where(inArray(tasks.userId, userIds))
        .groupBy(tasks.userId),
      this.database
        .select({ userId: notes.userId, total: count() })
        .from(notes)
        .where(inArray(notes.userId, userIds))
        .groupBy(notes.userId),
      this.database
        .select({ userId: habits.userId, total: count() })
        .from(habits)
        .where(inArray(habits.userId, userIds))
        .groupBy(habits.userId),
      this.database
        .select({ userId: projectMembers.userId, total: count() })
        .from(projectMembers)
        .where(inArray(projectMembers.userId, userIds))
        .groupBy(projectMembers.userId),
    ]);

    const providersMap = new Map<string, Set<string>>();
    for (const row of providerRows) {
      const set = providersMap.get(row.userId) ?? new Set<string>();
      set.add(row.providerId);
      providersMap.set(row.userId, set);
    }

    const sessionsMap = new Map(
      sessionRows.map((r) => [r.userId, Number(r.total)])
    );
    const tasksMap = new Map(taskCounts.map((r) => [r.userId, Number(r.total)]));
    const notesMap = new Map(noteCounts.map((r) => [r.userId, Number(r.total)]));
    const habitsMap = new Map(
      habitCounts.map((r) => [r.userId, Number(r.total)])
    );
    const projectsMap = new Map(
      projectCounts.map((r) => [r.userId, Number(r.total)])
    );

    return {
      items: pageRows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        role: u.role,
        isSuspended: u.isSuspended,
        timezone: u.timezone,
        createdAtMs: u.createdAt.getTime(),
        providers: Array.from(providersMap.get(u.id) ?? []),
        activeSessions: sessionsMap.get(u.id) ?? 0,
        tasksCount: tasksMap.get(u.id) ?? 0,
        notesCount: notesMap.get(u.id) ?? 0,
        habitsCount: habitsMap.get(u.id) ?? 0,
        projectsCount: projectsMap.get(u.id) ?? 0,
      })),
      total: Number(totalRow[0]?.value ?? 0),
      page,
      pageSize,
    };
  }

  async listPlatformTimeline(
    category: PlatformTimelineCategory = "all",
    limit = 60
  ): Promise<PlatformTimelineEvent[]> {
    const perSourceLimit = Math.min(40, Math.max(10, Math.ceil(limit * 0.6)));
    const includeAudit = category === "all" || category === "audit";
    const includeProject = category === "all" || category === "project";
    const includeUser = category === "all" || category === "user";
    const includeReminder = category === "all" || category === "reminder";

    const [auditRows, projectRows, userRows, reminderRows] = await Promise.all([
      includeAudit
        ? this.database
            .select({
              id: adminAuditLogs.id,
              action: adminAuditLogs.action,
              targetType: adminAuditLogs.targetType,
              metadataJson: adminAuditLogs.metadataJson,
              createdAt: adminAuditLogs.createdAt,
              actorName: users.name,
            })
            .from(adminAuditLogs)
            .leftJoin(users, eq(adminAuditLogs.actorUserId, users.id))
            .orderBy(desc(adminAuditLogs.createdAt))
            .limit(perSourceLimit)
        : Promise.resolve([]),
      includeProject
        ? this.database
            .select({
              id: projectActivities.id,
              action: projectActivities.action,
              createdAt: projectActivities.createdAt,
              actorName: users.name,
              projectName: projects.name,
            })
            .from(projectActivities)
            .leftJoin(users, eq(projectActivities.actorId, users.id))
            .leftJoin(projects, eq(projectActivities.projectId, projects.id))
            .orderBy(desc(projectActivities.createdAt))
            .limit(perSourceLimit)
        : Promise.resolve([]),
      includeUser
        ? this.database
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              emailVerified: users.emailVerified,
              createdAt: users.createdAt,
            })
            .from(users)
            .orderBy(desc(users.createdAt))
            .limit(perSourceLimit)
        : Promise.resolve([]),
      includeReminder
        ? this.database
            .select({
              id: reminders.id,
              taskId: reminders.taskId,
              sentAt: reminders.sentAt,
              timezone: reminders.timezone,
              userName: users.name,
            })
            .from(reminders)
            .leftJoin(users, eq(reminders.userId, users.id))
            .where(eq(reminders.status, "sent"))
            .orderBy(desc(reminders.sentAt))
            .limit(perSourceLimit)
        : Promise.resolve([]),
    ]);

    const events: PlatformTimelineEvent[] = [];

    for (const row of auditRows) {
      const meta = parseMetaSafe(row.metadataJson);
      const described = describeAuditEvent(row.action, meta, row.actorName);
      events.push({
        id: `audit-${row.id}`,
        category: "audit",
        tone: described.tone,
        action: row.action,
        title: described.title,
        detail: described.detail,
        actorName: row.actorName ?? "System",
        badgeLabel: "Admin Audit",
        createdAtMs: row.createdAt,
      });
    }

    for (const row of projectRows) {
      const described = describeSanitizedProjectActivity(
        row.action,
        row.actorName,
        row.projectName
      );
      events.push({
        id: `proj-${row.id}`,
        category: "project",
        tone: described.tone,
        action: row.action,
        title: described.title,
        detail: row.projectName ? `Workspace: ${row.projectName}` : null,
        actorName: row.actorName ?? "Member",
        badgeLabel: "Project",
        createdAtMs: row.createdAt,
      });
    }

    for (const row of userRows) {
      events.push({
        id: `user-${row.id}`,
        category: "user",
        tone: row.role === "admin" ? "collab" : "done",
        action: "user.registered",
        title: `${row.name} joined Folio`,
        detail: `${row.email} · ${row.emailVerified ? "Verified" : "Unverified"}${row.role === "admin" ? " · Admin" : ""}`,
        actorName: row.name,
        badgeLabel: "Signup",
        createdAtMs: row.createdAt.getTime(),
      });
    }

    for (const row of reminderRows) {
      if (!row.sentAt) continue;
      events.push({
        id: `rem-${row.id}`,
        category: "reminder",
        tone: "reminder",
        action: "reminder.delivered",
        title: `${row.taskId ? "Task" : "Note"} reminder dispatched`,
        detail: `${row.userName ?? "User"} · ${row.timezone}`,
        actorName: row.userName ?? "User",
        badgeLabel: "Delivery",
        createdAtMs: row.sentAt,
      });
    }

    events.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return events.slice(0, limit);
  }

  async getUserForAdminAction(
    userId: string,
    executor: DbExecutor = this.database
  ) {
    const [row] = await executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isSuspended: users.isSuspended,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row ?? null;
  }

  async recordAuditLog(
    input: {
      actorUserId: string | null;
      action: string;
      targetType: AdminAuditTargetType;
      targetId?: string | null;
      metadata?: Record<string, unknown>;
    },
    executor: DbExecutor = this.database
  ): Promise<AdminAuditLogRecord> {
    const [created] = await executor
      .insert(adminAuditLogs)
      .values({
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt: Date.now(),
      })
      .returning();

    if (!created) {
      throw new Error("Failed to persist admin audit log.");
    }
    return created;
  }

  async revokeUserSessions(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<number> {
    const deleted = await executor
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    return deleted.length;
  }

  async setUserSuspended(
    userId: string,
    suspended: boolean,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const updated = await executor
      .update(users)
      .set({ isSuspended: suspended, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return updated.length > 0;
  }

  async sweepExpiredRecords(
    nowMs: number,
    executor: DbExecutor = this.database
  ): Promise<SweepExpiredSummary> {
    const nowDate = new Date(nowMs);

    const expiredInvites = await executor
      .update(projectInvitations)
      .set({ status: "expired" })
      .where(
        and(
          eq(projectInvitations.status, "pending"),
          lte(projectInvitations.expiresAt, nowMs)
        )
      )
      .returning({ id: projectInvitations.id });

    const expiredMonitorReqs = await executor
      .update(habitMonitorRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(habitMonitorRequests.status, "pending"),
          lte(habitMonitorRequests.expiresAt, nowMs)
        )
      )
      .returning({ id: habitMonitorRequests.id });

    const expiredOpInvites = await executor
      .update(operationInvitations)
      .set({ status: "expired", respondedAt: nowMs })
      .where(
        and(
          eq(operationInvitations.status, "pending"),
          lte(operationInvitations.expiresAt, nowMs)
        )
      )
      .returning({ id: operationInvitations.id });

    const prunedSessions = await executor
      .delete(sessions)
      .where(lt(sessions.expiresAt, nowDate))
      .returning({ id: sessions.id });

    const prunedVerifs = await executor
      .delete(verifications)
      .where(lt(verifications.expiresAt, nowDate))
      .returning({ id: verifications.id });

    return {
      expiredProjectInvitations: expiredInvites.length,
      expiredHabitRequests: expiredMonitorReqs.length,
      expiredOperationInvitations: expiredOpInvites.length,
      prunedSessions: prunedSessions.length,
      prunedVerifications: prunedVerifs.length,
    };
  }
}

export const adminRepository: AdminRepository = new DrizzleAdminRepository(db);
