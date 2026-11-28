import { NotFoundError, ValidationError } from "@/server/dal/errors";
import {
  operationsSocialRepository,
  type OperationsSocialRepository,
} from "@/server/dal/operations-social";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import { defaultEventBus, type EventBus } from "@/server/providers/event-bus";
import {
  defaultUnreadCounterCache,
  type UnreadCounterCache,
} from "@/server/providers/redis/unread-counter-cache";
import {
  buildCancelledReminderEvent,
  ReminderService,
} from "./reminder-service";

export interface AccountServiceDeps {
  database?: AppDatabase;
  users?: UserRepository;
  projects?: ProjectRepository;
  reminders?: ReminderRepository;
  operationsSocial?: OperationsSocialRepository;
  unreadCache?: UnreadCounterCache;
  eventBus?: EventBus;
}

export interface DeleteAccountResult {
  deleted: true;
  cancelledReminderCount: number;
  deletedHandle?: string | null;
  deletedPublicSlugs?: string[];
}

export class AccountService {
  private readonly database: AppDatabase;
  private readonly users: UserRepository;
  private readonly projects: ProjectRepository;
  private readonly reminders: ReminderRepository;
  private readonly operationsSocial: OperationsSocialRepository;
  private readonly unreadCache: UnreadCounterCache;
  private readonly reminderService: ReminderService;

  constructor(deps: AccountServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.users = deps.users ?? userRepository;
    this.projects = deps.projects ?? projectRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.operationsSocial = deps.operationsSocial ?? operationsSocialRepository;
    this.unreadCache = deps.unreadCache ?? defaultUnreadCounterCache;
    this.reminderService = new ReminderService({
      database: this.database,
      reminders: this.reminders,
      eventBus: deps.eventBus ?? defaultEventBus,
    });
  }

  /**
   * Safely offboards a user account:
   * 1. Blocks deletion with a clear `ValidationError` if the user is the sole
   *    `owner` of any project with other active members.
   * 2. Collects all active `scheduled` reminder IDs (personal + owned projects)
   *    and public operation slugs inside an ACID transaction BEFORE cascading user deletion.
   * 3. Post-commit, resets cached unread counters and emits batched
   *    `app/reminder.cancelled` events.
   */
  async deleteAccount(userId: string): Promise<DeleteAccountResult> {
    const { cancelledEvents, deletedHandle, deletedPublicSlugs } =
      await withDbRetry(() =>
        this.database.transaction(async (tx) => {
          const user = await this.users.getById(userId, tx);
          if (!user) {
            throw new NotFoundError("Account not found.");
          }

          const blockingProjects =
            await this.projects.listSoleOwnedSharedProjects(userId, tx);
          if (blockingProjects.length > 0) {
            const names = blockingProjects
              .map((p) => `"${p.projectName}"`)
              .join(", ");
            throw new ValidationError(
              `You are the sole owner of shared project(s) with active members (${names}). Remove other members, transfer ownership, or delete those projects before deleting your account.`
            );
          }

          // Preserve co-owned shared projects by transferring `projects.owner_id` to
          // another active owner before `ON DELETE CASCADE` removes the user row.
          await this.projects.reassignCoOwnedProjectsBeforeUserDeletion(
            userId,
            tx
          );

          const publicSlugs =
            await this.operationsSocial.listPublicSlugsForOwner(userId, tx);

          const activeScheduled =
            await this.reminders.findActiveScheduledForUserAccountDeletion(
              userId,
              tx
            );

          const deleted = await this.users.deleteUserAccount(userId, tx);
          if (!deleted) {
            throw new NotFoundError("Account not found.");
          }

          return {
            deletedHandle: user.handle ?? null,
            deletedPublicSlugs: publicSlugs,
            cancelledEvents: activeScheduled.map((row) =>
              buildCancelledReminderEvent({
                reminderId: row.id,
                userId: row.userId,
                version: row.version,
              })
            ),
          };
        })
      );

    await this.unreadCache.reset(userId);

    if (cancelledEvents.length > 0) {
      await this.reminderService.emitControlEventsSafely(cancelledEvents);
    }

    return {
      deleted: true,
      cancelledReminderCount: cancelledEvents.length,
      deletedHandle,
      deletedPublicSlugs,
    };
  }
}

export const accountService = new AccountService();
