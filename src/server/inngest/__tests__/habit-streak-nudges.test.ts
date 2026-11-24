import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleHabitGroupRepository } from "@/server/dal/habit-groups";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import {
  habitGroupSharedHabits,
  habitLogs,
  habits,
  users,
} from "@/server/db/schema";
import {
  dispatchHabitStreakRiskBatch,
  executeHabitStreakRiskDelivery,
  type StreakNudgePayload,
} from "@/server/inngest/habit-streak-nudges";
import { InAppNotificationChannel } from "@/server/providers/channels/in-app-notification-channel";
import { InMemoryEventBus } from "@/server/providers/event-bus";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";
import { InMemoryUnreadCounterCache } from "@/server/providers/redis/unread-counter-cache";

class SpyChannel implements NotificationChannel {
  readonly sent: NotificationPayload[] = [];
  readonly name = "web_push";

  async send(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult> {
    this.sent.push(payload);
    return { channel: this.name, delivered: true };
  }
}

describe("Habit streak-risk nudges", () => {
  let tempDir: string;
  let conn: DbConnection;

  let aliceId: string;
  let bobId: string;
  let claraId: string;
  let daveId: string;
  let habitId: string;
  let groupId: string;

  let groupRepo: DrizzleHabitGroupRepository;
  let habitRepo: DrizzleHabitRepository;
  let notifications: DrizzleNotificationRepository;
  let bus: InMemoryEventBus;

  const NOW = Date.parse("2026-11-24T19:00:00.000Z");
  const dateKey = "2026-11-24";

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-streak-nudges-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [alice, bob, clara, dave] = await conn.db
      .insert(users)
      .values([
        {
          name: "Alice Owner",
          email: "alice-nudge@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Bob Quiet",
          email: "bob-nudge@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Clara Ready",
          email: "clara-nudge@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Dave Default",
          email: "dave-nudge@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();
    aliceId = alice!.id;
    bobId = bob!.id;
    claraId = clara!.id;
    daveId = dave!.id;

    groupRepo = new DrizzleHabitGroupRepository(conn.db);
    habitRepo = new DrizzleHabitRepository(conn.db);
    notifications = new DrizzleNotificationRepository(conn.db);
    bus = new InMemoryEventBus();

    // Members join via explicit invitation acceptance, matching PR #2's consent model.
    const group = await groupRepo.createGroupWithMembers({
      ownerId: aliceId,
      name: "Nudge Crew",
      description: null,
      invitedUserIds: [bobId, claraId],
      nowMs: NOW,
    });
    groupId = group.id;
    for (const userId of [bobId, claraId]) {
      await groupRepo.acceptInvitation({ groupId, userId, nowMs: NOW });
    }

    const [habit] = await conn.db
      .insert(habits)
      .values({
        userId: aliceId,
        title: "Morning workout",
        startDate: "2026-11-20",
        position: "a",
      })
      .returning();
    habitId = habit!.id;

    await conn.db.insert(habitGroupSharedHabits).values({
      groupId,
      habitId,
      sharedBy: aliceId,
      createdAt: NOW,
    });

    await conn.db.insert(habitLogs).values(
      ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"].map((day) => ({
        habitId,
        userId: aliceId,
        dateKey: day,
        status: "done" as const,
        loggedAt: NOW,
      }))
    );

    // A private habit is done every day, including today. If the scanner did
    // not filter logs by habitId, this would suppress the nudge and inflate
    // the streak.
    const [privateHabit] = await conn.db
      .insert(habits)
      .values({
        userId: aliceId,
        title: "Private journal",
        startDate: "2026-11-20",
        position: "b",
      })
      .returning();
    await conn.db.insert(habitLogs).values(
      ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", dateKey].map(
        (day) => ({
          habitId: privateHabit!.id,
          userId: aliceId,
          dateKey: day,
          status: "done" as const,
          loggedAt: NOW,
        })
      )
    );

    for (const userId of [aliceId, bobId, claraId, daveId]) {
      await habitRepo.getOrCreateSettings(userId);
    }
    // Opt-in is explicit; Bob is inside his quiet window at 19:00, Clara is not.
    for (const userId of [aliceId, bobId, claraId]) {
      await habitRepo.updateSettings(userId, { partnerNudgesEnabled: true });
    }
    await habitRepo.updateSettings(bobId, {
      nudgeQuietHoursStart: "18:00",
      nudgeQuietHoursEnd: "23:00",
    });
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("defaults partner nudges to off for new users", async () => {
    const settings = await habitRepo.getOrCreateSettings(daveId);
    expect(settings.partnerNudgesEnabled).toBe(false);
  });

  it("filters private habit logs, fetches once per owner, and emits only to available recipients", async () => {
    const logSpy = vi.spyOn(habitRepo, "listLogsForRange");
    try {
      const result = await dispatchHabitStreakRiskBatch(
        { limit: 10, offset: 0, nowMs: NOW },
        { groups: groupRepo, habits: habitRepo, eventBus: bus }
      );

      expect(result.candidatesChecked).toBe(3);
      expect(result.eventsEmitted).toBe(1);
      expect(bus.events).toHaveLength(1);
      const event = bus.events[0]!;
      expect(event.id).toBe(
        `habit-streak-risk:${groupId}:${aliceId}:${claraId}:${dateKey}`
      );
      expect(event.name).toBe("app/habit.streak_at_risk");
      expect(event.data).toMatchObject({
        ownerId: aliceId,
        recipientId: claraId,
        habitId,
        dateKey,
        currentStreak: 4,
        streakUnit: "days",
        reason: "unlogged",
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]?.[0]).toBe(aliceId);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not emit when the configured minimum streak is too high", async () => {
    bus.clear();
    await habitRepo.updateSettings(aliceId, { partnerNudgeMinStreak: 10 });
    const result = await dispatchHabitStreakRiskBatch(
      { limit: 10, offset: 0, nowMs: NOW },
      { groups: groupRepo, habits: habitRepo, eventBus: bus }
    );
    expect(result.eventsEmitted).toBe(0);
    await habitRepo.updateSettings(aliceId, { partnerNudgeMinStreak: 2 });
  });

  it("uses one deterministic entity id across channels, dedupes, and rechecks status", async () => {
    await dispatchHabitStreakRiskBatch(
      { limit: 10, offset: 0, nowMs: NOW },
      { groups: groupRepo, habits: habitRepo, eventBus: bus }
    );
    const nudge = bus.events[0]?.data as StreakNudgePayload;
    expect(nudge.recipientId).toBe(claraId);

    const webPush = new SpyChannel();
    const deps = {
      groups: groupRepo,
      habits: habitRepo,
      notifications,
      inAppChannel: new InAppNotificationChannel(
        notifications,
        new InMemoryUnreadCounterCache()
      ),
      webPushChannel: webPush,
      now: () => NOW,
    };

    const first = await executeHabitStreakRiskDelivery(nudge, deps);
    expect(first.status).toBe("delivered");
    expect(webPush.sent).toHaveLength(1);
    expect(webPush.sent[0]?.entityId).toBe(nudge.dedupKey);
    expect(webPush.sent[0]?.deepLink).toBe(`/app/habits/groups/${groupId}`);

    const inApp = (
      await notifications.listRecentForUser(claraId, 20)
    ).filter((item) => item.type === "habit.streak_risk");
    expect(inApp).toHaveLength(1);
    expect(inApp[0]?.entityId).toBe(nudge.dedupKey);

    const duplicate = await executeHabitStreakRiskDelivery(nudge, deps);
    expect(duplicate.status).toBe("skipped_duplicate");
    expect(webPush.sent).toHaveLength(1);

    const freshKey = (suffix: string) =>
      `habit-streak-risk:fresh-${suffix}:${groupId}:${aliceId}:${claraId}:${dateKey}`;

    await habitRepo.updateSettings(claraId, {
      partnerNudgesEnabled: false,
    });
    const recipientOptOut = await executeHabitStreakRiskDelivery(
      { ...nudge, dedupKey: freshKey("recipient-opt-out") },
      deps
    );
    expect(recipientOptOut.status).toBe("skipped_no_longer_active");
    await habitRepo.updateSettings(claraId, { partnerNudgesEnabled: true });

    await habitRepo.updateSettings(aliceId, {
      partnerNudgesEnabled: false,
    });
    const ownerOptOut = await executeHabitStreakRiskDelivery(
      { ...nudge, dedupKey: freshKey("owner-opt-out") },
      deps
    );
    expect(ownerOptOut.status).toBe("skipped_no_longer_active");
    await habitRepo.updateSettings(aliceId, { partnerNudgesEnabled: true });

    await conn.db.insert(habitLogs).values({
      habitId,
      userId: aliceId,
      dateKey,
      status: "done",
      loggedAt: NOW,
    });
    const logged = await executeHabitStreakRiskDelivery(
      { ...nudge, dedupKey: freshKey("logged") },
      deps
    );
    expect(logged.status).toBe("skipped_already_logged");
    expect(webPush.sent).toHaveLength(1);
  });

  it("cancels a queued nudge when the habit is unshared before delivery", async () => {
    const nudge = bus.events[0]?.data as StreakNudgePayload;
    const webPush = new SpyChannel();
    const deps = {
      groups: groupRepo,
      habits: habitRepo,
      notifications,
      inAppChannel: new InAppNotificationChannel(
        notifications,
        new InMemoryUnreadCounterCache()
      ),
      webPushChannel: webPush,
      now: () => NOW,
    };

    await groupRepo.unshareHabit({ groupId, habitId, actorId: aliceId });
    const result = await executeHabitStreakRiskDelivery(
      { ...nudge, dedupKey: "habit-streak-risk:unshared" },
      deps
    );
    expect(result.status).toBe("skipped_no_longer_active");
    expect(webPush.sent).toHaveLength(0);
  });

  it("loads all recipients of a group even when members span pages", async () => {
    const pagedUsers = await conn.db
      .insert(users)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          name: `Paged Member ${index}`,
          email: `paged-${index}-nudge@folio.test`,
          emailVerified: true,
          timezone: "UTC",
        }))
      )
      .returning();
    const pagedGroup = await groupRepo.createGroupWithMembers({
      ownerId: aliceId,
      name: "Paged Group",
      description: null,
      invitedUserIds: pagedUsers.map((user) => user.id),
      nowMs: NOW,
    });
    await Promise.all(
      pagedUsers.map((user) =>
        groupRepo.acceptInvitation({
          groupId: pagedGroup.id,
          userId: user.id,
          nowMs: NOW,
        })
      )
    );

    const allCandidates = await groupRepo.listActiveMemberCandidatesPage(
      500,
      0
    );
    const pagedIndex = allCandidates.findIndex(
      (candidate) => candidate.groupId === pagedGroup.id
    );
    expect(pagedIndex).toBeGreaterThanOrEqual(0);

    const [firstOfPagedGroup] = await groupRepo.listActiveMemberCandidatesPage(
      1,
      pagedIndex
    );
    expect(firstOfPagedGroup?.groupId).toBe(pagedGroup.id);
    expect(firstOfPagedGroup?.recipients).toHaveLength(100);
    expect(firstOfPagedGroup?.recipients.map((recipient) => recipient.userId)).toEqual(
      expect.arrayContaining(pagedUsers.map((user) => user.id))
    );
  });
});
