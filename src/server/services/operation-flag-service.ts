import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  assertOperationCapability,
  resolveOperationAccess,
} from "@/server/dal/operation-auth";
import {
  operationRepository,
  type OperationRepository,
} from "@/server/dal/operations";
import {
  operationsSocialRepository,
  type OperationStepFlagWithReporter,
  type OperationsSocialRepository,
} from "@/server/dal/operations-social";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type { OperationStepFlagRecord } from "@/server/db/schema";
import { parseStepsSnapshotJson } from "@/server/domain/operations";
import {
  defaultEventBus,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";

export const MAX_STEP_FLAG_MESSAGE_LENGTH = 500;

export interface OperationFlagServiceDeps {
  database?: AppDatabase;
  operations?: OperationRepository;
  social?: OperationsSocialRepository;
  users?: UserRepository;
  eventBus?: EventBus;
  rateLimiter?: RateLimiter;
  now?: () => number;
}

export class OperationFlagService {
  private readonly database: AppDatabase;
  private readonly operations: OperationRepository;
  private readonly social: OperationsSocialRepository;
  private readonly users: UserRepository;
  private readonly eventBus: EventBus;
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(deps: OperationFlagServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.operations = deps.operations ?? operationRepository;
    this.social = deps.social ?? operationsSocialRepository;
    this.users = deps.users ?? userRepository;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.now = deps.now ?? (() => Date.now());
  }

  async flagStep(
    userId: string,
    operationId: string,
    input: {
      stepKey: string;
      versionNumber?: number;
      message: string;
      unlistedToken?: string | null;
    }
  ): Promise<OperationStepFlagRecord> {
    const cleanMessage = input.message.trim();
    if (!cleanMessage || cleanMessage.length > MAX_STEP_FLAG_MESSAGE_LENGTH) {
      throw new ValidationError(
        `Flag note must be between 1 and ${MAX_STEP_FLAG_MESSAGE_LENGTH} characters.`
      );
    }

    const rate = await this.rateLimiter.limit("operation_flag", userId);
    if (!rate.allowed) {
      throw new RateLimitError({
        message: `Too many step flags submitted. Retry in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        limit: rate.limit,
        remaining: rate.remaining,
        resetAtMs: rate.resetAtMs,
      });
    }

    const nowMs = this.now();

    const { flag, operation, reporterName } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          {
            operationId,
            sessionUserId: userId,
            unlistedToken: input.unlistedToken,
          },
          tx
        );
        assertOperationCapability(
          access,
          "canFlagSteps",
          "Sign in with read access to flag a step."
        );

        const targetVersionNum =
          input.versionNumber ?? access.operation.currentVersion;
        const version =
          (await this.operations.getVersionByNumber(
            operationId,
            targetVersionNum,
            tx
          )) ?? (await this.operations.getLatestVersion(operationId, tx));
        if (!version) {
          throw new NotFoundError("Operation version not found.");
        }

        const steps = parseStepsSnapshotJson(version.stepsSnapshotJson);
        if (!steps.some((s) => s.key === input.stepKey)) {
          throw new ValidationError(
            `Step "${input.stepKey}" was not found in v${version.versionNumber}.`
          );
        }

        const reporter = await this.users.getById(userId, tx);
        const created = await this.social.createStepFlag(
          {
            operationId: access.operation.id,
            versionNumber: version.versionNumber,
            stepKey: input.stepKey,
            reporterId: userId,
            message: cleanMessage,
            nowMs,
          },
          tx
        );

        return {
          flag: created,
          operation: access.operation,
          reporterName: reporter?.name ?? "A runner",
        };
      })
    );

    if (operation.ownerId !== userId) {
      try {
        await this.eventBus.emit({
          id: `op-flag-${flag.id}`,
          name: "app/operation.step_flagged",
          data: {
            flagId: flag.id,
            operationId: operation.id,
            operationTitle: operation.title,
            ownerId: operation.ownerId,
            reporterName,
            stepKey: flag.stepKey,
            messagePreview: cleanMessage.slice(0, 140),
          },
        });
      } catch (error) {
        console.warn(
          "Operation step flag notification emit failed:",
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    return flag;
  }

  async listFlagsForMaintainer(
    userId: string,
    operationId: string
  ): Promise<OperationStepFlagWithReporter[]> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canResolveFlags",
      "Only owners and collaborators can review step flags."
    );
    return this.social.listFlagsForOperation(operationId);
  }

  async resolveFlag(
    userId: string,
    operationId: string,
    flagId: string
  ): Promise<OperationStepFlagRecord> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canResolveFlags",
      "Only owners and collaborators can resolve step flags."
    );

    const resolved = await withDbRetry(() =>
      this.social.resolveFlagAtomically(operationId, flagId, userId, this.now())
    );
    if (!resolved) {
      throw new ConflictError("Flag not found or already resolved.");
    }
    return resolved;
  }
}

export const operationFlagService = new OperationFlagService();
