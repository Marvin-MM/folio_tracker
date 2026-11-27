import { eq } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import { accounts, users, type UserRole } from "@/server/db/schema";

export interface UserPreferencesRecord {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  isSuspended: boolean;
  timezone: string;
  emailRemindersEnabled: boolean;
  handle: string | null;
  bio: string | null;
}

export interface UpdateUserPreferencesInput {
  name?: string;
  timezone?: string;
  emailRemindersEnabled?: boolean;
  handle?: string | null;
  bio?: string | null;
}

export interface UserRepository {
  getById(
    userId: string,
    executor?: DbExecutor
  ): Promise<UserPreferencesRecord | null>;
  findByHandle(
    handle: string,
    executor?: DbExecutor
  ): Promise<{ id: string; handle: string } | null>;
  updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
    executor?: DbExecutor
  ): Promise<UserPreferencesRecord | null>;
  listConnectedProviders(userId: string): Promise<string[]>;
  deleteUserAccount(userId: string, executor?: DbExecutor): Promise<boolean>;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async getById(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<UserPreferencesRecord | null> {
    const [record] = await executor
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        isSuspended: users.isSuspended,
        timezone: users.timezone,
        emailRemindersEnabled: users.emailRemindersEnabled,
        handle: users.handle,
        bio: users.bio,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return record ?? null;
  }

  async findByHandle(
    handle: string,
    executor: DbExecutor = this.database
  ): Promise<{ id: string; handle: string } | null> {
    const [row] = await executor
      .select({ id: users.id, handle: users.handle })
      .from(users)
      .where(eq(users.handle, handle.trim().toLowerCase()))
      .limit(1);
    return row && row.handle ? { id: row.id, handle: row.handle } : null;
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
    executor: DbExecutor = this.database
  ): Promise<UserPreferencesRecord | null> {
    const updates: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.timezone !== undefined) {
      updates.timezone = input.timezone;
    }
    if (input.emailRemindersEnabled !== undefined) {
      updates.emailRemindersEnabled = input.emailRemindersEnabled;
    }
    if (input.handle !== undefined) {
      updates.handle = input.handle;
    }
    if (input.bio !== undefined) {
      updates.bio = input.bio;
    }

    const [updated] = await executor
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        isSuspended: users.isSuspended,
        timezone: users.timezone,
        emailRemindersEnabled: users.emailRemindersEnabled,
        handle: users.handle,
        bio: users.bio,
      });

    return updated ?? null;
  }

  async listConnectedProviders(userId: string): Promise<string[]> {
    const rows = await this.database
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, userId));

    return Array.from(new Set(rows.map((row) => row.providerId)));
  }

  async deleteUserAccount(
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return deleted.length > 0;
  }
}

export const userRepository: UserRepository = new DrizzleUserRepository(db);
