import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  userRepository,
  type UpdateUserPreferencesInput,
  type UserPreferencesRecord,
  type UserRepository,
} from "@/server/dal/user-repository";
import { withDbRetry } from "@/server/db";
import {
  MAX_USER_BIO_LENGTH,
  validatePublicHandle,
} from "@/server/domain/operations";

function isUniqueHandleConstraintError(error: unknown): boolean {
  let cursor: unknown = error;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    if (cursor instanceof Error) {
      const msg = cursor.message.toLowerCase();
      if (msg.includes("unique") && msg.includes("handle")) {
        return true;
      }
      cursor = (cursor as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

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

    const updated = await withDbRetry(() =>
      this.repo.updatePreferences(userId, { timezone })
    );
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

    const normalizedPatch: UpdateUserPreferencesInput = { ...input };

    if (input.handle !== undefined) {
      if (input.handle === null || input.handle.trim() === "") {
        normalizedPatch.handle = null;
      } else {
        const verdict = validatePublicHandle(input.handle);
        if (!verdict.ok) {
          throw new ValidationError(verdict.message);
        }
        const existingOwner = await this.repo.findByHandle(verdict.handle);
        if (existingOwner && existingOwner.id !== userId) {
          throw new ConflictError(
            `The handle "@${verdict.handle}" is already taken.`
          );
        }
        normalizedPatch.handle = verdict.handle;
      }
    }

    if (input.bio !== undefined) {
      const cleanBio = input.bio?.trim() ?? "";
      if (cleanBio.length > MAX_USER_BIO_LENGTH) {
        throw new ValidationError(
          `Bio must be at most ${MAX_USER_BIO_LENGTH} characters.`
        );
      }
      normalizedPatch.bio = cleanBio || null;
    }

    let updated: UserPreferencesRecord | null;
    try {
      updated = await withDbRetry(() =>
        this.repo.updatePreferences(userId, normalizedPatch)
      );
    } catch (error) {
      if (isUniqueHandleConstraintError(error) && normalizedPatch.handle) {
        throw new ConflictError(
          `The handle "@${normalizedPatch.handle}" is already taken.`
        );
      }
      throw error;
    }
    if (!updated) {
      throw new NotFoundError("User account not found.");
    }
    return updated;
  }
}

export const userPreferencesService = new UserPreferencesService();
