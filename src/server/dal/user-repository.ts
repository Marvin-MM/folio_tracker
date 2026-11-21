import { eq } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import { accounts, users } from "@/server/db/schema";

export interface UserPreferencesRecord {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  timezone: string;
  emailRemindersEnabled: boolean;
}

export interface UpdateUserPreferencesInput {
  name?: string;
  timezone?: string;
  emailRemindersEnabled?: boolean;
}

export interface UserRepository {
  getById(
    userId: string,
    executor?: DbExecutor
  ): Promise<UserPreferencesRecord | null>;
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
        timezone: users.timezone,
        emailRemindersEnabled: users.emailRemindersEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return record ?? null;
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

    const [updated] = await executor
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        timezone: users.timezone,
        emailRemindersEnabled: users.emailRemindersEnabled,
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
