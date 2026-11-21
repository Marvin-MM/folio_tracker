import { relations } from "drizzle-orm";
import { accounts, sessions, users } from "./auth";
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

export const usersRelations = relations(users, ({ many }) => ({
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

export const tasksRelations = relations(tasks, ({ one }) => ({
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
}));

export const notesRelations = relations(notes, ({ one }) => ({
  author: one(users, {
    fields: [notes.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [notes.projectId],
    references: [projects.id],
  }),
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
