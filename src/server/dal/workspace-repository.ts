import { endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { db, type AppDatabase } from "@/server/db";
import {
  habits,
  notes,
  notifications,
  operations,
  projectMembers,
  projects,
  reminders,
  tasks,
  type NoteRecord,
  type ProjectRole,
  type ReminderRecord,
  type TaskRecord,
} from "@/server/db/schema";
import {
  defaultUnreadCounterCache,
  type UnreadCounterCache,
} from "@/server/providers/redis/unread-counter-cache";

export interface SidebarProjectItem {
  id: string;
  name: string;
  colorToken: string;
  role: ProjectRole;
  memberCount: number;
}

export interface SidebarSummary {
  inboxCount: number;
  todayCount: number;
  upcomingCount: number;
  remindersCount: number;
  notesCount: number;
  habitsCount: number;
  operationsCount: number;
  unreadNotificationsCount: number;
  projects: SidebarProjectItem[];
}

export interface TaskQueryResult {
  items: TaskRecord[];
  referenceUtcMs: number;
}

export interface WorkspaceRepository {
  getSidebarSummary(userId: string, timezone: string): Promise<SidebarSummary>;
  listInboxTasks(userId: string): Promise<TaskQueryResult>;
  listTodayTasks(userId: string, timezone: string): Promise<TaskQueryResult>;
  listUpcomingReminders(userId: string): Promise<ReminderRecord[]>;
  listNotes(userId: string): Promise<NoteRecord[]>;
}

function getEndOfTodayUtcMs(timezone: string, now: Date = new Date()): number {
  try {
    const zonedNow = toZonedTime(now, timezone);
    const zonedEnd = endOfDay(zonedNow);
    return fromZonedTime(zonedEnd, timezone).getTime();
  } catch {
    const zonedNow = toZonedTime(now, "UTC");
    return fromZonedTime(endOfDay(zonedNow), "UTC").getTime();
  }
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly database: AppDatabase = db,
    private readonly unreadCache: UnreadCounterCache = defaultUnreadCounterCache
  ) {}

  async getSidebarSummary(
    userId: string,
    timezone: string
  ): Promise<SidebarSummary> {
    const endOfTodayMs = getEndOfTodayUtcMs(timezone);
    const cachedUnread = await this.unreadCache.get(userId);

    // Wave 1: Execute all independent sidebar queries in a single pipelined
    // `db.batch()` (1 HTTP RTT to Turso instead of 9 parallel requests + 3 redundant reminder scans).
    const inboxQuery = this.database
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.projectId),
          inArray(tasks.status, ["todo", "in_progress"])
        )
      );

    const activeRemindersQuery = this.database
      .select({
        taskId: reminders.taskId,
        status: reminders.status,
        remindAt: reminders.remindAt,
      })
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
        )
      );

    const notesQuery = this.database
      .select({ value: count() })
      .from(notes)
      .where(and(eq(notes.userId, userId), isNull(notes.projectId)));

    const habitsQuery = this.database
      .select({ value: count() })
      .from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.isArchived, false)));

    const operationsQuery = this.database
      .select({ value: count() })
      .from(operations)
      .where(
        and(eq(operations.ownerId, userId), eq(operations.isArchived, false))
      );

    const memberProjectsQuery = this.database
      .select({
        id: projects.id,
        name: projects.name,
        colorToken: projects.colorToken,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(eq(projectMembers.userId, userId), eq(projects.isArchived, false))
      )
      .orderBy(asc(projects.name));

    let inboxRows: Array<{ value: number }>;
    let activeReminders: Array<{
      taskId: string | null;
      status: string;
      remindAt: number;
    }>;
    let noteRows: Array<{ value: number }>;
    let habitRows: Array<{ value: number }>;
    let operationRows: Array<{ value: number }>;
    let memberProjects: Array<{
      id: string;
      name: string;
      colorToken: string;
      role: ProjectRole;
    }>;
    let unreadCount: number;

    if (cachedUnread === null) {
      const unreadQuery = this.database
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.isRead, false)
          )
        );
      const [
        bInbox,
        bReminders,
        bNotes,
        bHabits,
        bOps,
        bProjects,
        bUnread,
      ] = await this.database.batch([
        inboxQuery,
        activeRemindersQuery,
        notesQuery,
        habitsQuery,
        operationsQuery,
        memberProjectsQuery,
        unreadQuery,
      ]);
      inboxRows = bInbox;
      activeReminders = bReminders;
      noteRows = bNotes;
      habitRows = bHabits;
      operationRows = bOps;
      memberProjects = bProjects;
      unreadCount = bUnread[0]?.value ?? 0;
    } else {
      const [bInbox, bReminders, bNotes, bHabits, bOps, bProjects] =
        await this.database.batch([
          inboxQuery,
          activeRemindersQuery,
          notesQuery,
          habitsQuery,
          operationsQuery,
          memberProjectsQuery,
        ]);
      inboxRows = bInbox;
      activeReminders = bReminders;
      noteRows = bNotes;
      habitRows = bHabits;
      operationRows = bOps;
      memberProjects = bProjects;
      unreadCount = cachedUnread;
    }

    const todayRemTaskIdSet = new Set<string>();
    const upcomingRemTaskIdSet = new Set<string>();
    for (const rem of activeReminders) {
      if (!rem.taskId) continue;
      if (
        (rem.status === "scheduled" || rem.status === "snoozed") &&
        rem.remindAt <= endOfTodayMs
      ) {
        todayRemTaskIdSet.add(rem.taskId);
      } else if (rem.remindAt > endOfTodayMs) {
        upcomingRemTaskIdSet.add(rem.taskId);
      }
    }
    const todayRemTaskIds = Array.from(todayRemTaskIdSet);
    const upcomingRemTaskIds = Array.from(upcomingRemTaskIdSet);
    const projectIds = memberProjects.map((p) => p.id);

    const activeProjectMembershipPredicate = or(
      isNull(tasks.projectId),
      exists(
        this.database
          .select({ one: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, tasks.projectId),
              eq(projectMembers.userId, userId)
            )
          )
      )
    );

    // Wave 2: Execute today count, upcoming count, and project member counts
    // together in ONE single `db.batch()` (plus async Redis cache write in parallel).
    const todayCountQuery = this.database
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          activeProjectMembershipPredicate,
          inArray(tasks.status, ["todo", "in_progress"]),
          todayRemTaskIds.length > 0
            ? or(
                lte(tasks.dueAt, endOfTodayMs),
                inArray(tasks.id, todayRemTaskIds)
              )
            : lte(tasks.dueAt, endOfTodayMs)
        )
      );

    const upcomingCountQuery = this.database
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          activeProjectMembershipPredicate,
          inArray(tasks.status, ["todo", "in_progress"]),
          upcomingRemTaskIds.length > 0
            ? or(
                gt(tasks.dueAt, endOfTodayMs),
                inArray(tasks.id, upcomingRemTaskIds)
              )
            : gt(tasks.dueAt, endOfTodayMs)
        )
      );

    const cacheSetPromise =
      cachedUnread === null
        ? this.unreadCache.set(userId, unreadCount)
        : Promise.resolve();

    let todayRows: Array<{ value: number }>;
    let upcomingRows: Array<{ value: number }>;
    let memberCounts: Array<{ projectId: string; value: number }>;

    if (projectIds.length > 0) {
      const memberCountsQuery = this.database
        .select({
          projectId: projectMembers.projectId,
          value: count(),
        })
        .from(projectMembers)
        .where(inArray(projectMembers.projectId, projectIds))
        .groupBy(projectMembers.projectId);

      const [[bToday, bUpcoming, bMembers]] = await Promise.all([
        this.database.batch([
          todayCountQuery,
          upcomingCountQuery,
          memberCountsQuery,
        ]),
        cacheSetPromise,
      ]);
      todayRows = bToday;
      upcomingRows = bUpcoming;
      memberCounts = bMembers;
    } else {
      const [[bToday, bUpcoming]] = await Promise.all([
        this.database.batch([todayCountQuery, upcomingCountQuery]),
        cacheSetPromise,
      ]);
      todayRows = bToday;
      upcomingRows = bUpcoming;
      memberCounts = [];
    }

    const memberCountMap = new Map(
      memberCounts.map((row) => [row.projectId, row.value])
    );

    return {
      inboxCount: inboxRows[0]?.value ?? 0,
      todayCount: todayRows[0]?.value ?? 0,
      upcomingCount: upcomingRows[0]?.value ?? 0,
      remindersCount: activeReminders.length,
      notesCount: noteRows[0]?.value ?? 0,
      habitsCount: habitRows[0]?.value ?? 0,
      operationsCount: operationRows[0]?.value ?? 0,
      unreadNotificationsCount: unreadCount,
      projects: memberProjects.map((project) => ({
        ...project,
        memberCount: memberCountMap.get(project.id) ?? 1,
      })),
    };
  }

  async listInboxTasks(userId: string): Promise<TaskQueryResult> {
    const items = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.projectId),
          inArray(tasks.status, ["todo", "in_progress"])
        )
      )
      .orderBy(asc(tasks.position), asc(tasks.id))
      .limit(100);

    return { items, referenceUtcMs: Date.now() };
  }

  async listTodayTasks(
    userId: string,
    timezone: string
  ): Promise<TaskQueryResult> {
    const referenceUtcMs = Date.now();
    const endOfTodayMs = getEndOfTodayUtcMs(
      timezone,
      new Date(referenceUtcMs)
    );

    const activeProjectMembershipPredicate = or(
      isNull(tasks.projectId),
      exists(
        this.database
          .select({ one: projectMembers.userId })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, tasks.projectId),
              eq(projectMembers.userId, userId)
            )
          )
      )
    );

    const items = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          activeProjectMembershipPredicate,
          inArray(tasks.status, ["todo", "in_progress"]),
          lte(tasks.dueAt, endOfTodayMs)
        )
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.position), asc(tasks.id))
      .limit(100);

    return { items, referenceUtcMs };
  }

  async listUpcomingReminders(userId: string): Promise<ReminderRecord[]> {
    return this.database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
        )
      )
      .orderBy(asc(reminders.remindAt), asc(reminders.id))
      .limit(100);
  }

  async listNotes(userId: string): Promise<NoteRecord[]> {
    return this.database
      .select()
      .from(notes)
      .where(and(eq(notes.userId, userId), isNull(notes.projectId)))
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt), asc(notes.id))
      .limit(100);
  }
}

export const workspaceRepository: WorkspaceRepository =
  new DrizzleWorkspaceRepository(db);
