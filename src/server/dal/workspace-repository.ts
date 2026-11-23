import { endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { db, type AppDatabase } from "@/server/db";
import {
  habits,
  notes,
  notifications,
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

    const [
      inboxRows,
      todayReminderTaskRows,
      upcomingReminderTaskRows,
      reminderRows,
      noteRows,
      habitRows,
      unreadRows,
      memberProjects,
    ] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            isNull(tasks.projectId),
            inArray(tasks.status, ["todo", "in_progress"])
          )
        ),
      this.database
        .select({ taskId: reminders.taskId })
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            isNotNull(reminders.taskId),
            inArray(reminders.status, ["scheduled", "snoozed"]),
            lte(reminders.remindAt, endOfTodayMs)
          )
        ),
      this.database
        .select({ taskId: reminders.taskId })
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            isNotNull(reminders.taskId),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"]),
            gt(reminders.remindAt, endOfTodayMs)
          )
        ),
      this.database
        .select({ value: count() })
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
          )
        ),
      this.database
        .select({ value: count() })
        .from(notes)
        .where(and(eq(notes.userId, userId), isNull(notes.projectId))),
      this.database
        .select({ value: count() })
        .from(habits)
        .where(and(eq(habits.userId, userId), eq(habits.isArchived, false))),
      cachedUnread === null
        ? this.database
            .select({ value: count() })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, userId),
                eq(notifications.isRead, false)
              )
            )
        : Promise.resolve([{ value: cachedUnread }]),
      this.database
        .select({
          id: projects.id,
          name: projects.name,
          colorToken: projects.colorToken,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(
          and(
            eq(projectMembers.userId, userId),
            eq(projects.isArchived, false)
          )
        )
        .orderBy(asc(projects.name)),
    ]);

    const unreadCount = unreadRows[0]?.value ?? 0;
    if (cachedUnread === null) {
      await this.unreadCache.set(userId, unreadCount);
    }

    const projectIds = memberProjects.map((p) => p.id);
    const memberCounts =
      projectIds.length > 0
        ? await this.database
            .select({
              projectId: projectMembers.projectId,
              value: count(),
            })
            .from(projectMembers)
            .where(inArray(projectMembers.projectId, projectIds))
            .groupBy(projectMembers.projectId)
        : [];

    const memberCountMap = new Map(
      memberCounts.map((row) => [row.projectId, row.value])
    );

    const todayRemTaskIds = Array.from(
      new Set(
        todayReminderTaskRows
          .map((r) => r.taskId)
          .filter((id): id is string => typeof id === "string")
      )
    );
    const upcomingRemTaskIds = Array.from(
      new Set(
        upcomingReminderTaskRows
          .map((r) => r.taskId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const [todayRows, upcomingRows] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            inArray(tasks.status, ["todo", "in_progress"]),
            todayRemTaskIds.length > 0
              ? or(
                  lte(tasks.dueAt, endOfTodayMs),
                  inArray(tasks.id, todayRemTaskIds)
                )
              : lte(tasks.dueAt, endOfTodayMs)
          )
        ),
      this.database
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            inArray(tasks.status, ["todo", "in_progress"]),
            upcomingRemTaskIds.length > 0
              ? or(
                  gt(tasks.dueAt, endOfTodayMs),
                  inArray(tasks.id, upcomingRemTaskIds)
                )
              : gt(tasks.dueAt, endOfTodayMs)
          )
        ),
    ]);

    return {
      inboxCount: inboxRows[0]?.value ?? 0,
      todayCount: todayRows[0]?.value ?? 0,
      upcomingCount: upcomingRows[0]?.value ?? 0,
      remindersCount: reminderRows[0]?.value ?? 0,
      notesCount: noteRows[0]?.value ?? 0,
      habitsCount: habitRows[0]?.value ?? 0,
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

    const items = await this.database
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
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
