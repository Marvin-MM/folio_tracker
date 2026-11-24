import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleHabitGroupRepository } from "@/server/dal/habit-groups";
import { DrizzleHabitSocialRepository } from "@/server/dal/habits-social";
import { DrizzleNotificationRepository } from "@/server/dal/notification-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { habits, users } from "@/server/db/schema";
import { HabitGroupService } from "@/server/services/habit-group-service";

describe("Habit groups — membership, sharing and review isolation", () => {
  let tempDir: string;
  let conn: DbConnection;

  let aliceId: string;
  let bobId: string;
  let claraId: string;
  let danId: string;

  let groupRepo: DrizzleHabitGroupRepository;
  let habitRepo: DrizzleHabitRepository;
  let service: HabitGroupService;
  let groupId: string;
  let aliceHabitId: string;
  let bobHabitId: string;

  const NOW = Date.parse("2026-11-24T12:00:00.000Z");

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-habit-groups-test-"));
    conn = createDbConnection({ url: `file:${path.join(tempDir, "test.db")}` });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    const [alice, bob, clara, dan] = await conn.db
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
          email: "bob-group@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Clara Group",
          email: "clara-group@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
        {
          name: "Dan Outsider",
          email: "dan-group@folio.test",
          emailVerified: true,
          timezone: "UTC",
        },
      ])
      .returning();
    aliceId = alice!.id;
    bobId = bob!.id;
    claraId = clara!.id;
    danId = dan!.id;

    groupRepo = new DrizzleHabitGroupRepository(conn.db);
    habitRepo = new DrizzleHabitRepository(conn.db);
    const socialRepo = new DrizzleHabitSocialRepository(conn.db);
    const notifications = new DrizzleNotificationRepository(conn.db);
    service = new HabitGroupService({
      database: conn.db,
      groups: groupRepo,
      social: socialRepo,
      habits: habitRepo,
      notifications,
      now: () => NOW,
    });

    const group = await service.createGroup(aliceId, {
      name: "Monday Momentum",
      description: "Three-person review board",
      memberEmails: ["bob-group@folio.test", "clara-group@folio.test"],
    });
    groupId = group.id;

    const [aliceHabit, bobHabit] = await conn.db
      .insert(habits)
      .values([
        {
          userId: aliceId,
          title: "Alice morning walk",
          startDate: "2026-11-01",
          position: "a",
        },
        {
          userId: bobId,
          title: "Bob reading",
          startDate: "2026-11-01",
          position: "b",
        },
      ])
      .returning();
    aliceHabitId = aliceHabit!.id;
    bobHabitId = bobHabit!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires three verified members and excludes unverified accounts", async () => {
    await expect(
      service.createGroup(aliceId, {
        name: "Too small",
        memberEmails: ["bob-group@folio.test"],
      })
    ).rejects.toThrow(/at least two other people/i);

    await conn.db.insert(users).values({
      name: "Unverified User",
      email: "unverified-group@folio.test",
      emailVerified: false,
      timezone: "UTC",
    });
    await expect(
      service.createGroup(aliceId, {
        name: "Bad invite",
        memberEmails: [
          "bob-group@folio.test",
          "unverified-group@folio.test",
        ],
      })
    ).rejects.toThrow(/verified FOLIO account/i);
  });

  it("only lets habit owners share, and only members read shared habits", async () => {
    await expect(
      service.shareHabit(bobId, groupId, aliceHabitId)
    ).rejects.toBeInstanceOf(ForbiddenError);

    await service.shareHabit(aliceId, groupId, aliceHabitId);
    await service.shareHabit(bobId, groupId, bobHabitId);

    const sharedForClara = await groupRepo.listSharedHabits(groupId, claraId);
    expect(sharedForClara.map((habit) => habit.habitId).sort()).toEqual(
      [aliceHabitId, bobHabitId].sort()
    );
    await expect(
      groupRepo.listSharedHabits(groupId, danId)
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.getWorkspace(danId, groupId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hides removed members' shared habits and revokes their workspace access", async () => {
    await service.removeMember(aliceId, groupId, bobId);

    const sharedAfterRemoval = await groupRepo.listSharedHabits(groupId, claraId);
    expect(sharedAfterRemoval.map((habit) => habit.habitId)).toEqual([
      aliceHabitId,
    ]);
    await expect(
      service.getWorkspace(bobId, groupId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("denies member management to non-managers", async () => {
    await expect(
      service.addMemberByEmail(claraId, groupId, "dan-group@folio.test")
    ).rejects.toBeInstanceOf(ForbiddenError);

    const added = await service.addMemberByEmail(
      aliceId,
      groupId,
      "dan-group@folio.test"
    );
    expect(added.userId).toBe(danId);
    const members = await groupRepo.listMembers(groupId, aliceId);
    expect(members.map((m) => m.userId)).toContain(danId);
  });
});
