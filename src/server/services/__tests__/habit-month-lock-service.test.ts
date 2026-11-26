import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MonthLockedError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import { DrizzleHabitRepository } from "@/server/dal/habits";
import { DrizzleProjectRepository } from "@/server/dal/project-repository";
import { DrizzleTaskRepository } from "@/server/dal/task-repository";
import { createDbConnection, type DbConnection } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { TEMP_UNLOCK_DURATION_MS } from "@/server/domain/habit-month-lock";
import { InMemoryRateLimiter } from "@/server/providers/redis/rate-limiter";
import { HabitService } from "@/server/services/habit-service";

describe("HabitService dynamic month locking, PIN lockout & backfill enforcement", () => {
  let tempDir: string;
  let conn: DbConnection;
  let userId: string;
  let currentNowMs = Date.parse("2026-11-27T12:00:00.000Z");
  let habitService: HabitService;
  let rateLimiter: InMemoryRateLimiter;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "folio-month-lock-"));
    conn = createDbConnection({
      url: `file:${path.join(tempDir, "test.db")}`,
    });
    await migrate(conn.db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    await conn.enableForeignKeys();

    rateLimiter = new InMemoryRateLimiter({ now: () => currentNowMs });
    habitService = new HabitService({
      database: conn.db,
      habits: new DrizzleHabitRepository(conn.db),
      tasks: new DrizzleTaskRepository(conn.db),
      projects: new DrizzleProjectRepository(conn.db),
      rateLimiter,
      now: () => currentNowMs,
    });

    const [u] = await conn.db
      .insert(users)
      .values({
        id: "01MONTHLOCKUSER00000000001",
        name: "Lock Tester",
        email: "lock.tester@folio.test",
        emailVerified: true,
        timezone: "UTC",
      })
      .returning();
    userId = u!.id;
  });

  afterAll(() => {
    conn.client.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces auto-lock, closing_today manual lock, PIN brute-force lockout, 30m temp unlock & Option 2A backfill rules", async () => {
    // 1. Seed a habit starting in Oct 2026 while clock is Nov 27, 2026
    const habit = await habitService.createHabit(userId, "UTC", {
      title: "Morning Meditation",
      startDate: "2026-10-01",
      targetYearMonth: "2026-11",
    });

    // Mid-month November cannot be locked early
    await expect(
      habitService.lockMonth(userId, "UTC", "2026-11")
    ).rejects.toBeInstanceOf(ValidationError);

    // October 2026 is already past the default 3-day grace window on Nov 27 -> locked_auto!
    const octWs = await habitService.getMonthWorkspace(userId, "UTC", {
      yearMonth: "2026-10",
    });
    expect(octWs.monthLock.phase).toBe("locked_auto");
    expect(octWs.monthLock.isLocked).toBe(true);
    expect(octWs.settings.hasMonthLockPin).toBe(false);
    expect("monthLockPinHash" in octWs.settings).toBe(false);

    // Editing auto-locked October directly MUST throw MonthLockedError
    await expect(
      habitService.logHabitDay(userId, "UTC", {
        habitId: habit.id,
        dateKey: "2026-10-15",
        status: "done",
      })
    ).rejects.toBeInstanceOf(MonthLockedError);

    await expect(
      habitService.saveMonthRoster(userId, "UTC", {
        yearMonth: "2026-10",
        habitIds: [habit.id],
      })
    ).rejects.toBeInstanceOf(MonthLockedError);

    // Option 2A: Auto-locked past month allows backfill when allowAutoLockedBackfill=true,
    // and rejects when allowAutoLockedBackfill=false.
    await expect(
      habitService.bulkImportHistory(userId, "UTC", {
        rows: [
          { title: "Morning Meditation", dateKey: "2026-10-05", status: "done" },
        ],
        createMissing: false,
        archiveRemoved: false,
        allowAutoLockedBackfill: false,
        monthRosters: [],
        aliasOverrides: [],
      })
    ).rejects.toBeInstanceOf(MonthLockedError);

    const backfillOk = await habitService.bulkImportHistory(userId, "UTC", {
      rows: [
        { title: "Morning Meditation", dateKey: "2026-10-05", status: "done" },
      ],
      createMissing: false,
      archiveRemoved: false,
      allowAutoLockedBackfill: true,
      monthRosters: [],
      aliasOverrides: [],
    });
    expect(backfillOk.importedCount).toBe(1);

    // 2. Configure an Accountability PIN ("2468") and verify zero secret leak
    const updatedSettings = await habitService.setMonthLockPin(userId, {
      newPin: "2468",
    });
    expect(updatedSettings.hasMonthLockPin).toBe(true);
    expect("monthLockPinHash" in updatedSettings).toBe(false);

    // 3. Wrong PIN 4 times -> ValidationError; 5th time -> RateLimitError (15-min lockout)
    for (let i = 0; i < 4; i++) {
      await expect(
        habitService.unlockMonth(userId, "UTC", {
          yearMonth: "2026-10",
          pin: "9999",
        })
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      habitService.unlockMonth(userId, "UTC", {
        yearMonth: "2026-10",
        pin: "9999",
      })
    ).rejects.toBeInstanceOf(RateLimitError);

    // Even the right PIN is blocked during active lockout
    await expect(
      habitService.unlockMonth(userId, "UTC", {
        yearMonth: "2026-10",
        pin: "2468",
      })
    ).rejects.toBeInstanceOf(RateLimitError);

    // Advance clock 16 minutes -> lockout clears, valid PIN unlocks for 30 minutes
    currentNowMs += 16 * 60_000;
    const unlocked = await habitService.unlockMonth(userId, "UTC", {
      yearMonth: "2026-10",
      pin: "2468",
      reason: "Correcting travel entry",
    });
    expect(unlocked.phase).toBe("unlocked_temp");
    expect(unlocked.isLocked).toBe(false);
    expect(unlocked.unlockCount).toBe(1);

    // Editing October succeeds during the 30-minute window
    const loggedDuringWindow = await habitService.logHabitDay(userId, "UTC", {
      habitId: habit.id,
      dateKey: "2026-10-15",
      status: "done",
    });
    expect(loggedDuringWindow.log?.status).toBe("done");

    // Advance clock 31 minutes -> auto-relocks automatically!
    currentNowMs += TEMP_UNLOCK_DURATION_MS + 60_000;
    await expect(
      habitService.logHabitDay(userId, "UTC", {
        habitId: habit.id,
        dateKey: "2026-10-16",
        status: "done",
      })
    ).rejects.toBeInstanceOf(MonthLockedError);

    // 4. Advance clock to Nov 30, 2026 (closing_today) -> manual lock succeeds!
    currentNowMs = Date.parse("2026-11-30T19:00:00.000Z");
    const novClosing = await habitService.getMonthWorkspace(userId, "UTC", {
      yearMonth: "2026-11",
    });
    expect(novClosing.monthLock.phase).toBe("closing_today");
    expect(novClosing.monthLock.canLockNow).toBe(true);

    const lockedNov = await habitService.lockMonth(userId, "UTC", "2026-11");
    expect(lockedNov.phase).toBe("locked_manual");
    expect(lockedNov.isLocked).toBe(true);

    // Manually locked month MUST ALWAYS reject historical imports even with allowAutoLockedBackfill=true!
    await expect(
      habitService.bulkImportHistory(userId, "UTC", {
        rows: [
          { title: "Morning Meditation", dateKey: "2026-11-02", status: "done" },
        ],
        createMissing: false,
        archiveRemoved: false,
        allowAutoLockedBackfill: true,
        monthRosters: [],
        aliasOverrides: [],
      })
    ).rejects.toBeInstanceOf(MonthLockedError);

    // 5. Change and remove PIN cleanly
    await habitService.setMonthLockPin(userId, {
      currentPin: "2468",
      newPin: "135790",
    });
    const removed = await habitService.removeMonthLockPin(userId, {
      currentPin: "135790",
    });
    expect(removed.hasMonthLockPin).toBe(false);
  });
});
