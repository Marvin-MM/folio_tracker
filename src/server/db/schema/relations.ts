import { relations } from "drizzle-orm";
import { adminAuditLogs } from "./admin";
import { accounts, sessions, users } from "./auth";
import {
  habitDayEntries,
  habitExcuseRanges,
  habitSavedViews,
  undoSnapshots,
} from "./habit-extensions";
import {
  habitImportAliases,
  habitLogs,
  habitMonthLocks,
  habitMonthRosters,
  habits,
  habitTrackerSettings,
} from "./habits";
import {
  habitComments,
  habitMonitorItems,
  habitMonitorRequests,
  habitMonitors,
  habitReactions,
  habitWeeklySnapshots,
} from "./habits-social";
import { notifications, pushSubscriptions } from "./notifications";
import {
  operationReferenceNotes,
  operationRuns,
  operationRunSteps,
  operations,
  operationVersions,
} from "./operations";
import {
  operationInvitations,
  operationMembers,
  operationStepFlags,
  userFollows,
} from "./operations-social";
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
  habitImportAliases: many(habitImportAliases),
  habitMonthRosters: many(habitMonthRosters),
  habitMonthLocks: many(habitMonthLocks),
  habitLogs: many(habitLogs),
  habitExcuseRanges: many(habitExcuseRanges),
  habitSavedViews: many(habitSavedViews),
  habitDayEntries: many(habitDayEntries),
  undoSnapshots: many(undoSnapshots),
  habitMonitorsAsOwner: many(habitMonitors, {
    relationName: "habitMonitorOwner",
  }),
  habitMonitorsAsMonitor: many(habitMonitors, {
    relationName: "habitMonitorWatcher",
  }),
  sentHabitMonitorRequests: many(habitMonitorRequests, {
    relationName: "habitRequestOwner",
  }),
  receivedHabitMonitorRequests: many(habitMonitorRequests, {
    relationName: "habitRequestTarget",
  }),
  habitWeeklySnapshots: many(habitWeeklySnapshots),
  habitCommentsOwned: many(habitComments, {
    relationName: "habitCommentOwner",
  }),
  habitCommentsAuthored: many(habitComments, {
    relationName: "habitCommentAuthor",
  }),
  habitReactionsOwned: many(habitReactions, {
    relationName: "habitReactionOwner",
  }),
  habitReactionsAuthored: many(habitReactions, {
    relationName: "habitReactionAuthor",
  }),
  ownedOperations: many(operations),
  createdOperationVersions: many(operationVersions),
  operationRuns: many(operationRuns),
  followingUsers: many(userFollows, { relationName: "userFollower" }),
  followerUsers: many(userFollows, { relationName: "userFollowing" }),
  operationMemberships: many(operationMembers, {
    relationName: "operationMemberUser",
  }),
  operationInvitationsSent: many(operationInvitations, {
    relationName: "operationInviteSender",
  }),
  operationInvitationsReceived: many(operationInvitations, {
    relationName: "operationInviteTarget",
  }),
  operationStepFlagsReported: many(operationStepFlags, {
    relationName: "operationFlagReporter",
  }),
  adminAuditLogs: many(adminAuditLogs),
}));

export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [adminAuditLogs.actorUserId],
    references: [users.id],
  }),
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
  operations: many(operations),
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
  operation: one(operations, {
    fields: [tasks.operationId],
    references: [operations.id],
  }),
  operationRun: one(operationRuns, {
    fields: [tasks.operationRunId],
    references: [operationRuns.id],
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
  operationLinks: many(operationReferenceNotes),
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
  importAliases: many(habitImportAliases),
  monthRosters: many(habitMonthRosters),
  linkedTasks: many(tasks),
  linkedOperations: many(operations),
  monitorItems: many(habitMonitorItems),
  comments: many(habitComments),
}));

export const habitMonthRostersRelations = relations(
  habitMonthRosters,
  ({ one }) => ({
    user: one(users, {
      fields: [habitMonthRosters.userId],
      references: [users.id],
    }),
    habit: one(habits, {
      fields: [habitMonthRosters.habitId],
      references: [habits.id],
    }),
  })
);

export const habitMonthLocksRelations = relations(
  habitMonthLocks,
  ({ one }) => ({
    user: one(users, {
      fields: [habitMonthLocks.userId],
      references: [users.id],
    }),
  })
);

export const habitImportAliasesRelations = relations(
  habitImportAliases,
  ({ one }) => ({
    user: one(users, {
      fields: [habitImportAliases.userId],
      references: [users.id],
    }),
    habit: one(habits, {
      fields: [habitImportAliases.habitId],
      references: [habits.id],
    }),
  })
);

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

export const habitMonitorsRelations = relations(
  habitMonitors,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [habitMonitors.ownerId],
      references: [users.id],
      relationName: "habitMonitorOwner",
    }),
    monitorUser: one(users, {
      fields: [habitMonitors.monitorUserId],
      references: [users.id],
      relationName: "habitMonitorWatcher",
    }),
    items: many(habitMonitorItems),
  })
);

export const habitMonitorItemsRelations = relations(
  habitMonitorItems,
  ({ one }) => ({
    monitor: one(habitMonitors, {
      fields: [habitMonitorItems.monitorId],
      references: [habitMonitors.id],
    }),
    habit: one(habits, {
      fields: [habitMonitorItems.habitId],
      references: [habits.id],
    }),
  })
);

export const habitMonitorRequestsRelations = relations(
  habitMonitorRequests,
  ({ one }) => ({
    owner: one(users, {
      fields: [habitMonitorRequests.ownerId],
      references: [users.id],
      relationName: "habitRequestOwner",
    }),
    targetUser: one(users, {
      fields: [habitMonitorRequests.targetUserId],
      references: [users.id],
      relationName: "habitRequestTarget",
    }),
  })
);

export const habitWeeklySnapshotsRelations = relations(
  habitWeeklySnapshots,
  ({ one }) => ({
    owner: one(users, {
      fields: [habitWeeklySnapshots.ownerId],
      references: [users.id],
    }),
  })
);

export const habitCommentsRelations = relations(
  habitComments,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [habitComments.ownerId],
      references: [users.id],
      relationName: "habitCommentOwner",
    }),
    author: one(users, {
      fields: [habitComments.authorId],
      references: [users.id],
      relationName: "habitCommentAuthor",
    }),
    targetHabit: one(habits, {
      fields: [habitComments.targetHabitId],
      references: [habits.id],
    }),
    parent: one(habitComments, {
      fields: [habitComments.parentCommentId],
      references: [habitComments.id],
      relationName: "habitCommentThread",
    }),
    replies: many(habitComments, {
      relationName: "habitCommentThread",
    }),
  })
);

export const habitReactionsRelations = relations(habitReactions, ({ one }) => ({
  owner: one(users, {
    fields: [habitReactions.ownerId],
    references: [users.id],
    relationName: "habitReactionOwner",
  }),
  author: one(users, {
    fields: [habitReactions.authorId],
    references: [users.id],
    relationName: "habitReactionAuthor",
  }),
}));

export const operationsRelations = relations(operations, ({ one, many }) => ({
  owner: one(users, {
    fields: [operations.ownerId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [operations.projectId],
    references: [projects.id],
  }),
  linkedHabit: one(habits, {
    fields: [operations.linkedHabitId],
    references: [habits.id],
  }),
  forkedFrom: one(operations, {
    fields: [operations.forkedFromId],
    references: [operations.id],
    relationName: "operationForks",
  }),
  forks: many(operations, {
    relationName: "operationForks",
  }),
  versions: many(operationVersions),
  referenceNotes: many(operationReferenceNotes),
  runs: many(operationRuns),
  members: many(operationMembers),
  invitations: many(operationInvitations),
  stepFlags: many(operationStepFlags),
  linkedTasks: many(tasks),
}));

export const operationVersionsRelations = relations(
  operationVersions,
  ({ one, many }) => ({
    operation: one(operations, {
      fields: [operationVersions.operationId],
      references: [operations.id],
    }),
    createdBy: one(users, {
      fields: [operationVersions.createdById],
      references: [users.id],
    }),
    runs: many(operationRuns),
  })
);

export const operationReferenceNotesRelations = relations(
  operationReferenceNotes,
  ({ one }) => ({
    operation: one(operations, {
      fields: [operationReferenceNotes.operationId],
      references: [operations.id],
    }),
    note: one(notes, {
      fields: [operationReferenceNotes.noteId],
      references: [notes.id],
    }),
  })
);

export const operationRunsRelations = relations(
  operationRuns,
  ({ one, many }) => ({
    operation: one(operations, {
      fields: [operationRuns.operationId],
      references: [operations.id],
    }),
    version: one(operationVersions, {
      fields: [operationRuns.versionId],
      references: [operationVersions.id],
    }),
    runner: one(users, {
      fields: [operationRuns.runnerId],
      references: [users.id],
    }),
    steps: many(operationRunSteps),
    linkedTasks: many(tasks),
  })
);

export const operationRunStepsRelations = relations(
  operationRunSteps,
  ({ one }) => ({
    run: one(operationRuns, {
      fields: [operationRunSteps.runId],
      references: [operationRuns.id],
    }),
  })
);

export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  follower: one(users, {
    fields: [userFollows.followerId],
    references: [users.id],
    relationName: "userFollower",
  }),
  following: one(users, {
    fields: [userFollows.followingId],
    references: [users.id],
    relationName: "userFollowing",
  }),
}));

export const operationMembersRelations = relations(
  operationMembers,
  ({ one }) => ({
    operation: one(operations, {
      fields: [operationMembers.operationId],
      references: [operations.id],
    }),
    user: one(users, {
      fields: [operationMembers.userId],
      references: [users.id],
      relationName: "operationMemberUser",
    }),
    grantedBy: one(users, {
      fields: [operationMembers.grantedById],
      references: [users.id],
      relationName: "operationMemberGrantor",
    }),
  })
);

export const operationInvitationsRelations = relations(
  operationInvitations,
  ({ one }) => ({
    operation: one(operations, {
      fields: [operationInvitations.operationId],
      references: [operations.id],
    }),
    invitedBy: one(users, {
      fields: [operationInvitations.invitedById],
      references: [users.id],
      relationName: "operationInviteSender",
    }),
    targetUser: one(users, {
      fields: [operationInvitations.targetUserId],
      references: [users.id],
      relationName: "operationInviteTarget",
    }),
  })
);

export const operationStepFlagsRelations = relations(
  operationStepFlags,
  ({ one }) => ({
    operation: one(operations, {
      fields: [operationStepFlags.operationId],
      references: [operations.id],
    }),
    reporter: one(users, {
      fields: [operationStepFlags.reporterId],
      references: [users.id],
      relationName: "operationFlagReporter",
    }),
    resolvedBy: one(users, {
      fields: [operationStepFlags.resolvedById],
      references: [users.id],
      relationName: "operationFlagResolver",
    }),
  })
);

export const habitExcuseRangesRelations = relations(
  habitExcuseRanges,
  ({ one }) => ({
    user: one(users, {
      fields: [habitExcuseRanges.userId],
      references: [users.id],
    }),
  })
);

export const habitSavedViewsRelations = relations(
  habitSavedViews,
  ({ one }) => ({
    user: one(users, {
      fields: [habitSavedViews.userId],
      references: [users.id],
    }),
  })
);

export const habitDayEntriesRelations = relations(
  habitDayEntries,
  ({ one }) => ({
    user: one(users, {
      fields: [habitDayEntries.userId],
      references: [users.id],
    }),
  })
);

export const undoSnapshotsRelations = relations(undoSnapshots, ({ one }) => ({
  user: one(users, {
    fields: [undoSnapshots.userId],
    references: [users.id],
  }),
}));
