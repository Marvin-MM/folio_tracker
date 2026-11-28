import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  habitSavedViews,
  type HabitSavedViewRecord,
  type NewHabitSavedViewRecord,
} from "@/server/db/schema";
import type { NewHabitSavedViewRow } from "@/server/domain/habit-views";

export interface CreateSavedViewRowInput {
  id: string;
  userId: string;
  name: string;
  kind: NewHabitSavedViewRecord["kind"];
  filterJson: string;
  groupBy: NewHabitSavedViewRecord["groupBy"];
  sortBy: NewHabitSavedViewRecord["sortBy"];
  orderIndex: number;
}

export interface UpdateSavedViewRowInput {
  name?: string;
  hidden?: boolean;
  orderIndex?: number;
  filterJson?: string;
  groupBy?: NewHabitSavedViewRecord["groupBy"];
  sortBy?: NewHabitSavedViewRecord["sortBy"];
}

export interface HabitViewRepository {
  seedBuiltIns(
    userId: string,
    rows: NewHabitSavedViewRow[],
    executor?: DbExecutor
  ): Promise<number>;
  list(userId: string, executor?: DbExecutor): Promise<HabitSavedViewRecord[]>;
  create(
    input: CreateSavedViewRowInput,
    executor?: DbExecutor
  ): Promise<HabitSavedViewRecord>;
  update(
    userId: string,
    viewId: string,
    patch: UpdateSavedViewRowInput,
    executor?: DbExecutor
  ): Promise<HabitSavedViewRecord | null>;
  softDelete(
    userId: string,
    viewId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
}

export class DrizzleHabitViewRepository implements HabitViewRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async seedBuiltIns(
    userId: string,
    rows: NewHabitSavedViewRow[],
    executor: DbExecutor = this.database
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await executor
      .insert(habitSavedViews)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: habitSavedViews.id });
    return inserted.length;
  }

  async list(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<HabitSavedViewRecord[]> {
    return executor
      .select()
      .from(habitSavedViews)
      .where(
        and(eq(habitSavedViews.userId, userId), isNull(habitSavedViews.deletedAt))
      )
      .orderBy(asc(habitSavedViews.orderIndex), asc(habitSavedViews.id));
  }

  async create(
    input: CreateSavedViewRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitSavedViewRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(habitSavedViews)
      .values({
        id: input.id,
        userId: input.userId,
        name: input.name,
        kind: input.kind,
        builtIn: false,
        hidden: false,
        orderIndex: input.orderIndex,
        filterJson: input.filterJson,
        groupBy: input.groupBy,
        sortBy: input.sortBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create saved view.");
    }
    return created;
  }

  async update(
    userId: string,
    viewId: string,
    patch: UpdateSavedViewRowInput,
    executor: DbExecutor = this.database
  ): Promise<HabitSavedViewRecord | null> {
    const [updated] = await executor
      .update(habitSavedViews)
      .set({ ...patch, updatedAt: Date.now() })
      .where(
        and(
          eq(habitSavedViews.userId, userId),
          eq(habitSavedViews.id, viewId),
          isNull(habitSavedViews.deletedAt)
        )
      )
      .returning();

    return updated ?? null;
  }

  async softDelete(
    userId: string,
    viewId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const updated = await executor
      .update(habitSavedViews)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(
        and(
          eq(habitSavedViews.userId, userId),
          eq(habitSavedViews.id, viewId),
          eq(habitSavedViews.builtIn, false),
          isNull(habitSavedViews.deletedAt)
        )
      )
      .returning({ id: habitSavedViews.id });

    return updated.length > 0;
  }
}

export const habitViewRepository: HabitViewRepository =
  new DrizzleHabitViewRepository();
