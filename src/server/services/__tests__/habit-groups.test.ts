import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleHabitGroupRepository } from "@/server/dal/habit-groups";
import { DrizzleHabitSocialRepository } from "@/server/dal/habits-social";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { HabitGroupService } from "@/server/services/habit-group-service";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";

describe("Habit groups — invite consent, sharing and review isolation", () => {
  let tempDir: string;
  let conn: DbConnection;

  let aliceId: string;
  let bobId: string;
  let claraId: string;
  let danId: string;
  let eveId: string;

  let groupRepo: DrizzleHabitGroupRepository;
  let habitRepo: DrizzleHabitRepository;
  let socialRepo: DrizzleHabitSocialRepository;
  let notifications: DrizzleNotificationRepository;
  let service: HabitGroupService;
  let groupId: string;
  let aliceHabitId: string;
  let alicePrivateHabitId: string;
  let bobHabitId: string;

  const NOW = Date.parse("2026-11-24T12:00:00.000Z");
  const BOB_EMAIL = "bob-group@folio.test";
  const CLARA_EMAIL = "clara-group@folio.test";
  const DAN_EMAIL = "dan-group@folio.test";
  const EVE_EMAIL = "eve-group@folio.test";

  const insertLog = async (
    habitId: string,
    userId: string,
    dateKey: string,
    status: "done" | "missed" | "skipped"
  ) => {
    await habitRepo.upsertLog({
      habitId,
      userId,
      dateKey,
      status,
      loggedAt: NOW,
      isBackfilledLate: false,
    });
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-habit-groups-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [alice, bob, clara, dan, eve] = await conn.db
      .insert(users)
      .values([
        {
          name: "Alice Group",
          email: "alice-group@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Bob Group",
          email: BOB_EMAIL,
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Clara Group",
          email: CLARA_EMAIL,
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Dan Group",
          email: DAN_EMAIL,
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Eve Unverified",
          email: EVE_EMAIL,
          emailVerified: false,
          timezone: "UTC",
        },
      ])
      .returning();
    aliceId = alice!.id;
    bobId = bob!.id;
    claraId = clara!.id;
    danId = dan!.id;
    eveId = eve!.id;

    groupRepo = new DrizzleHabitGroupRepository(conn.db);
    habitRepo = new DrizzleHabitRepository(conn.db);
    socialRepo = new DrizzleHabitSocialRepository(conn.db);
    notifications = new DrizzleNotificationRepository(conn.db);
    service = new HabitGroupService({
      database: conn.db,
      groups: groupRepo,
      social: socialRepo,
      habits: habitRepo,
      notifications,
      rateLimiter: new InMemoryRateLimiter(),
      now: () => NOW,
    });

    const group = await service.createGroup(aliceId, {
      name: "Monday Momentum",
      description: "Three-person review board",
      memberEmails: [
        BOB_EMAIL,
        CLARA_EMAIL,
        "missing-group@folio.test",
        EVE_EMAIL,
      ],
    });
    groupId = group.id;

    await service.acceptGroupInvitation(bobId, groupId);
    await service.acceptGroupInvitation(claraId, groupId);

    const [aliceHabit, alicePrivateHabit, bobHabit] = await Promise.all([
      habitRepo.createHabit({
        userId: aliceId,
        title: "Alice morning walk",
        startDate: "2026-11-01",
        cadenceType: "daily",
        scheduledDaysJson: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        position: "a",
      }),
      habitRepo.createHabit({
        userId: aliceId,
        title: "Alice private journal",
        startDate: "2026-11-01",
        cadenceType: "daily",
        scheduledDaysJson: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        position: "b",
      }),
      habitRepo.createHabit({
        userId: bobId,
        title: "Bob reading",
        startDate: "2026-11-01",
        cadenceType: "daily",
        scheduledDaysJson: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        position: "c",
      }),
    ]);

    aliceHabitId = aliceHabit.id;
    alicePrivateHabitId = alicePrivateHabit.id;
    bobHabitId = bobHabit.id;

    await service.shareHabit(aliceId, groupId, aliceHabitId);
    await service.shareHabit(bobId, groupId, bobHabitId);

    const dates = [
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ];
    for (const dateKey of dates) {
      await insertLog(aliceHabitId, aliceId, dateKey, "missed");
      await insertLog(alicePrivateHabitId, aliceId, dateKey, "done");
      await insertLog(bobHabitId, bobId, dateKey, "done");
    }
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires explicit consent and never enumeration", async () => {
    const bobInvites = await service.listPendingInvitations(bobId);
    expect(bobInvites).toHaveLength(0);

    const groupInvitations = await groupRepo.listPendingInvitationsForUser(bobId);
    expect(groupInvitations).toHaveLength(0);
    expect(
      await groupRepo.listPendingInvitationsForUser(eveId)
    ).toHaveLength(0);

    const members = await groupRepo.listMembers(groupId, aliceId);
    expect(members.map((member) => member.userId).sort()).toEqual(
      [aliceId, bobId, claraId].sort()
    );
    for (const member of members) {
      expect(member.email).toContain("***@");
      expect(member.email).not.toBe(BOB_EMAIL);
      expect(member.email).not.toBe(CLARA_EMAIL);
    }
    expect(members.some((member) => member.email === BOB_EMAIL)).toBe(false);
  });

  it("ignores unknown and unverified invite emails without leaking account state", async () => {
    await expect(
      service.inviteMemberByEmail(aliceId, groupId, "nobody-group@folio.test")
    ).resolves.toBeUndefined();
    await expect(
      service.inviteMemberByEmail(aliceId, groupId, EVE_EMAIL)
    ).resolves.toBeUndefined();

    expect(
      await groupRepo.listPendingInvitationsForUser(eveId)
    ).toHaveLength(0);
    const members = await groupRepo.listMembers(groupId, aliceId);
    expect(members.map((member) => member.userId)).not.toContain(eveId);
  });

  it("filters metrics by habitId and fetches logs once per habit owner", async () => {
    const listLogsSpy = vi.spyOn(habitRepo, "listLogsForRange");
    try {
      const workspace = await service.getWorkspace(claraId, groupId);
      const aliceMetric = workspace.metrics.find(
        (metric) => metric.ownerId === aliceId
      );
      const bobMetric = workspace.metrics.find(
        (metric) => metric.ownerId === bobId
      );

      // Alice's private habit is done every day; the shared habit is missed
      // every day. Only the shared habit may be reflected in the metric.
      expect(aliceMetric?.doneCount).toBe(0);
      expect(aliceMetric?.scheduledCount).toBe(7);
      expect(aliceMetric?.completionPct).toBe(0);
      expect(bobMetric?.doneCount).toBe(7);
      expect(bobMetric?.completionPct).toBe(100);

      expect(listLogsSpy).toHaveBeenCalledTimes(2);
      expect(
        listLogsSpy.mock.calls.map(([userId]) => userId).sort()
      ).toEqual([aliceId, bobId].sort());
    } finally {
      listLogsSpy.mockRestore();
    }
  });

  it("only lets habit owners share, and only members read shared habits", async () => {
    await expect(
      service.shareHabit(bobId, groupId, aliceHabitId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    const sharedForClara = await groupRepo.listSharedHabits(groupId, claraId);
    expect(sharedForClara).toHaveLength(2);
    await expect(
      groupRepo.listSharedHabits(groupId, danId)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.getWorkspace(danId, groupId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("protects owners and admins from removal", async () => {
    const secondGroup = await service.createGroup(aliceId, {
      name: "Second Group",
      memberEmails: [BOB_EMAIL, CLARA_EMAIL],
    });
    await service.acceptGroupInvitation(bobId, secondGroup.id);
    await service.acceptGroupInvitation(claraId, secondGroup.id);
    await service.setMemberRole(aliceId, secondGroup.id, claraId, "admin");

    await expect(
      service.removeMember(claraId, secondGroup.id, aliceId)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.removeMember(aliceId, secondGroup.id, aliceId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    const removed = await groupRepo.removeMember({
      groupId: secondGroup.id,
      actorId: aliceId,
      userId: bobId,
    });
    expect(removed).toBe(true);
  });

  it("supports invite acceptance and decline without granting pre-consent access", async () => {
    await service.inviteMemberByEmail(aliceId, groupId, DAN_EMAIL);
    expect(
      (await groupRepo.listPendingInvitationsForUser(danId)).map(
        (invite) => invite.id
      )
    ).toContain(groupId);
    await expect(
      service.getWorkspace(danId, groupId)
    ).rejects.toBeInstanceOf(NotFoundError);

    await service.acceptGroupInvitation(danId, groupId);
    expect((await service.getWorkspace(danId, groupId)).group.id).toBe(groupId);

    const declineGroup = await service.createGroup(aliceId, {
      name: "Decline Group",
      memberEmails: [BOB_EMAIL, CLARA_EMAIL],
    });
    await service.inviteMemberByEmail(aliceId, declineGroup.id, DAN_EMAIL);
    await service.declineGroupInvitation(danId, declineGroup.id);
    expect(
      await groupRepo.listPendingInvitationsForUser(danId)
    ).toHaveLength(0);
    await expect(
      service.getWorkspace(danId, declineGroup.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("delegates leaving to the repository and protects the owner", async () => {
    const leaveSpy = vi.spyOn(groupRepo, "leaveGroup");
    try {
      await expect(service.leaveGroup(aliceId, groupId)).rejects.toBeInstanceOf(
        ValidationError
      );
      await service.leaveGroup(claraId, groupId);
      expect(leaveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ groupId, userId: claraId })
      );
      await expect(
        service.getWorkspace(claraId, groupId)
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      leaveSpy.mockRestore();
    }
  });

  it("rate limits group creation and invitations", async () => {
    const limitedService = new HabitGroupService({
      database: conn.db,
      groups: groupRepo,
      social: socialRepo,
      habits: habitRepo,
      notifications,
      rateLimiter: new InMemoryRateLimiter({
        policies: {
          habit_group_create: {
            maxRequests: 1,
            windowMs: 60_000,
            upstashWindow: "1 m",
          },
          habit_group_invite: {
            maxRequests: 1,
            windowMs: 60_000,
            upstashWindow: "1 m",
          },
        },
      }),
      now: () => NOW,
    });

    const limitedGroup = await limitedService.createGroup(aliceId, {
      name: "Limited Group",
      memberEmails: [BOB_EMAIL, CLARA_EMAIL],
    });
    await expect(
      limitedService.createGroup(aliceId, {
        name: "Another Limited Group",
        memberEmails: [BOB_EMAIL, CLARA_EMAIL],
      })
    ).rejects.toBeInstanceOf(RateLimitError);

    await limitedService.inviteMemberByEmail(
      aliceId,
      limitedGroup.id,
      DAN_EMAIL
    );
    await expect(
      limitedService.inviteMemberByEmail(
        aliceId,
        limitedGroup.id,
        DAN_EMAIL
      )
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
