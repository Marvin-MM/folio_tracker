import { NotFoundError, ValidationError } from "@/server/dal/errors";
import {
  userRepository,
  type UpdateUserPreferencesInput,
  type UserPreferencesRecord,
  type UserRepository,
} from "@/server/dal/user-repository";

export function isValidIanaTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 100) {
    return false;
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export class UserPreferencesService {
  constructor(private readonly repo: UserRepository = userRepository) {}

  async syncTimezone(
    userId: string,
    timezone: string
  ): Promise<UserPreferencesRecord> {
    if (!isValidIanaTimezone(timezone)) {
      throw new ValidationError("Unsupported IANA timezone identifier.");
    }

    const updated = await this.repo.updatePreferences(userId, { timezone });
    if (!updated) {
      throw new NotFoundError("User account not found.");
    }
    return updated;
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput
  ): Promise<UserPreferencesRecord> {
    if (input.timezone !== undefined && !isValidIanaTimezone(input.timezone)) {
      throw new ValidationError("Unsupported IANA timezone identifier.");
    }

    const updated = await this.repo.updatePreferences(userId, input);
    if (!updated) {
      throw new NotFoundError("User account not found.");
    }
    return updated;
  }
}

export const userPreferencesService = new UserPreferencesService();
