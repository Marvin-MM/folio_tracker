import { relations } from "drizzle-orm";
import { accounts, sessions, users } from "./auth";
import { habitLogs, habits, habitTrackerSettings } from "./habits";
import { notifications, pushSubscriptions } from "./notifications";
import { reminders } from "./reminders";
import {
  notes,
  projectActivities,
  projectInvitations,
  projectMembers,
  projects,
  tasks,
} from "./workspace";

export const usersRelations = relations(users, ({ one, many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  ownedProjects: many(projects),
  projectMemberships: many(projectMembers),
  sentInvitations: many(projectInvitations),
  createdTasks: many(tasks, { relationName: "taskCreator" }),
  assignedTasks: many(tasks, { relationName: "taskAssignee" }),
  notes: many(notes),
  activities: many(projectActivities),
  reminders: many(reminders),
  pushSubscriptions: many(pushSubscriptions),
  notifications: many(notifications),
  habitTrackerSettings: one(habitTrackerSettings, {
    fields: [users.id],
    references: [habitTrackerSettings.userId],
  }),
  habits: many(habits),
  habitLogs: many(habitLogs),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  members: many(projectMembers),
  invitations: many(projectInvitations),
  tasks: many(tasks),
  notes: many(notes),
  activities: many(projectActivities),
  linkedHabits: many(habits),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const projectInvitationsRelations = relations(
  projectInvitations,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectInvitations.projectId],
      references: [projects.id],
    }),
    invitedBy: one(users, {
      fields: [projectInvitations.invitedById],
      references: [users.id],
    }),
  })
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  creator: one(users, {
    fields: [tasks.userId],
    references: [users.id],
    relationName: "taskCreator",
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: "taskAssignee",
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  habit: one(habits, {
    fields: [tasks.habitId],
    references: [habits.id],
  }),
  reminders: many(reminders),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  author: one(users, {
    fields: [notes.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [notes.projectId],
    references: [projects.id],
  }),
  reminders: many(reminders),
}));

export const projectActivitiesRelations = relations(
  projectActivities,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectActivities.projectId],
      references: [projects.id],
    }),
    actor: one(users, {
      fields: [projectActivities.actorId],
      references: [users.id],
    }),
  })
);

export const remindersRelations = relations(reminders, ({ one }) => ({
  user: one(users, {
    fields: [reminders.userId],
    references: [users.id],
  }),
  task: one(tasks, {
    fields: [reminders.taskId],
    references: [tasks.id],
  }),
  note: one(notes, {
    fields: [reminders.noteId],
    references: [notes.id],
  }),
}));

export const pushSubscriptionsRelations = relations(
  pushSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [pushSubscriptions.userId],
      references: [users.id],
    }),
  })
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const habitTrackerSettingsRelations = relations(
  habitTrackerSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [habitTrackerSettings.userId],
      references: [users.id],
    }),
  })
);

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, {
    fields: [habits.userId],
    references: [users.id],
  }),
  linkedProject: one(projects, {
    fields: [habits.linkedProjectId],
    references: [projects.id],
  }),
  logs: many(habitLogs),
  linkedTasks: many(tasks),
}));

export const habitLogsRelations = relations(habitLogs, ({ one }) => ({
  habit: one(habits, {
    fields: [habitLogs.habitId],
    references: [habits.id],
  }),
  user: one(users, {
    fields: [habitLogs.userId],
    references: [users.id],
  }),
}));
