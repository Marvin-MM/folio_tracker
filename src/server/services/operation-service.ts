import { randomBytes } from "node:crypto";
import {
  generateEvenPositions,
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  assertProjectRole,
  canUserReadAllNotes,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConcurrencyConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  SecretScanBlockedError,
  SecretScanWarningAckRequiredError,
  ValidationError,
} from "@/server/dal/errors";
import { habitRepository, type HabitRepository } from "@/server/dal/habits";
import {
  assertOperationCapability,
  hashUnlistedOperationToken,
  resolveOperationAccess,
  type OperationCapabilities,
  type OperationEffectiveRole,
} from "@/server/dal/operation-auth";
import {
  operationRepository,
  type OperationListRow,
  type OperationReferenceNoteSummary,
  type OperationRepository,
  type OperationRunListRow,
} from "@/server/dal/operations";
import {
  operationsSocialRepository,
  type OperationInvitationWithMeta,
  type OperationStepFlagWithReporter,
  type OperationsSocialRepository,
  type SharedOperationListItem,
} from "@/server/dal/operations-social";
import { getCachedPublicExploreOperations } from "@/server/dal/public-operations-cache";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import {
  taskRepository,
  type TaskRepository,
  type TaskScope,
} from "@/server/dal/task-repository";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import {
  workspaceRepository,
  type WorkspaceRepository,
} from "@/server/dal/workspace-repository";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  OperationDifficulty,
  OperationDomain,
  OperationRecord,
  OperationVersionRecord,
  OperationVisibility,
  ReminderRecord,
  TaskPriority,
  TaskRecord,
} from "@/server/db/schema";
import {
  appendSlugSuffix,
  computeOperationStaleness,
  MAX_OPERATION_SUMMARY_LENGTH,
  MAX_OPERATION_TITLE_LENGTH,
  MAX_REFERENCE_NOTES,
  normalizeOperationTags,
  operationPrerequisitesSchemaArray,
  operationStepsSchemaArray,
  operationVariablesSchemaArray,
  parseOperationTagsJson,
  parsePrerequisitesJson,
  parseStepsSnapshotJson,
  parseVariablesSchemaJson,
  scanOperationForSecrets,
  slugifyOperationTitle,
  sortOperationSteps,
  type OperationPrerequisite,
  type OperationStalenessInfo,
  type OperationStep,
  type OperationVariable,
  type PublicOperationCardDto,
  type SecretScanFinding,
} from "@/server/domain/operations";
import { defaultEventBus, type EventBus } from "@/server/providers/event-bus";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";
import { ReminderService } from "./reminder-service";

export interface OperationLinkOptions {
  projects: Array<{ id: string; name: string; colorToken: string }>;
  habits: Array<{ id: string; title: string; category: string | null }>;
  notes: Array<{ id: string; title: string; projectId: string | null }>;
}

export interface HydratedOperationVersion {
  id: string;
  operationId: string;
  versionNumber: number;
  variables: OperationVariable[];
  prerequisites: OperationPrerequisite[];
  steps: OperationStep[];
  changeSummary: string | null;
  createdById: string | null;
  createdAt: number;
}

export interface HydratedOperationListItem extends OperationListRow {
  tags: string[];
  staleness: OperationStalenessInfo;
}

export interface OperationsHubPayload {
  operations: HydratedOperationListItem[];
  activeRuns: OperationRunListRow[];
  recentRuns: OperationRunListRow[];
  sharedWithMe: SharedOperationListItem[];
  pendingInvitations: OperationInvitationWithMeta[];
  exploreOperations: PublicOperationCardDto[];
  linkOptions: OperationLinkOptions;
}

export interface OperationDetailPayload {
  operation: OperationRecord;
  tags: string[];
  staleness: OperationStalenessInfo;
  access: {
    role: OperationEffectiveRole;
    accessSource:
      | "owner"
      | "direct_member"
      | "project_inherited"
      | "unlisted_token"
      | "public";
    capabilities: OperationCapabilities;
  };
  owner: {
    id: string;
    name: string;
    handle: string | null;
  };
  currentVersion: HydratedOperationVersion;
  versions: HydratedOperationVersion[];
  referenceNotes: OperationReferenceNoteSummary[];
  recentRuns: OperationRunListRow[];
  openFlags: OperationStepFlagWithReporter[];
  linkedProject: { id: string; name: string; colorToken: string } | null;
  linkedHabit: { id: string; title: string } | null;
  linkOptions: OperationLinkOptions;
}

export interface CreateOperationInput {
  title: string;
  summary?: string;
  domain: OperationDomain;
  tags?: string[];
  difficulty?: OperationDifficulty | null;
  estimatedMinutes?: number | null;
  visibility?: OperationVisibility;
  allowForking?: boolean;
  shareWithProject?: boolean;
  reviewCycleDays?: number | null;
  projectId?: string | null;
  linkedHabitId?: string | null;
  referenceNoteIds?: string[];
  variables?: OperationVariable[];
  prerequisites?: OperationPrerequisite[];
  steps: OperationStep[];
  changeSummary?: string | null;
  acknowledgeWarnings?: boolean;
}

export interface PublishOperationVersionInput extends CreateOperationInput {
  expectedEditVersion: number;
}

export interface RollbackOperationVersionInput {
  targetVersionNumber: number;
  expectedEditVersion: number;
  changeSummary?: string | null;
  acknowledgeWarnings?: boolean;
}

export interface UpdateOperationVisibilityInput {
  visibility: OperationVisibility;
  allowForking?: boolean;
  acknowledgeWarnings?: boolean;
}

export interface UpdateOperationProjectSharingInput {
  projectId: string | null;
  shareWithProject: boolean;
}

export interface ScheduleOperationRunTaskInput {
  title?: string;
  dueAt?: number | null;
  remindAt?: number | null;
  priority?: TaskPriority;
  timezone: string;
}

export interface OperationMutationResult {
  operation: OperationRecord;
  version: HydratedOperationVersion;
  secretScanWarnings: SecretScanFinding[];
  mintedUnlistedToken: string | null;
  ownerHandle: string | null;
  affectsPublicCache?: boolean;
  forkSlugs?: string[];
}

export interface OperationVisibilityMutationResult {
  operation: OperationRecord;
  secretScanWarnings: SecretScanFinding[];
  mintedUnlistedToken: string | null;
  ownerHandle: string | null;
  affectsPublicCache?: boolean;
  forkSlugs?: string[];
}

export interface OperationServiceDeps {
  database?: AppDatabase;
  operations?: OperationRepository;
  social?: OperationsSocialRepository;
  habits?: HabitRepository;
  tasks?: TaskRepository;
  projects?: ProjectRepository;
  reminders?: ReminderRepository;
  users?: UserRepository;
  workspace?: WorkspaceRepository;
  membershipLookup?: ProjectMembershipLookup;
  reminderService?: ReminderService;
  eventBus?: EventBus;
  rateLimiter?: RateLimiter;
  now?: () => number;
}

function mintUnlistedToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashUnlistedOperationToken(rawToken),
  };
}

function hydrateVersion(row: OperationVersionRecord): HydratedOperationVersion {
  return {
    id: row.id,
    operationId: row.operationId,
    versionNumber: row.versionNumber,
    variables: parseVariablesSchemaJson(row.variablesSchemaJson),
    prerequisites: parsePrerequisitesJson(row.prerequisitesJson),
    steps: parseStepsSnapshotJson(row.stepsSnapshotJson),
    changeSummary: row.changeSummary,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}

function normalizeStepsWithPositions(steps: OperationStep[]): OperationStep[] {
  const sorted = sortOperationSteps(steps);
  const freshPositions = generateEvenPositions(sorted.length);
  return sorted.map((step, index) => ({
    ...step,
    position: step.position.trim() || freshPositions[index]!,
    title: step.title.trim(),
    bodyMarkdown: step.bodyMarkdown ?? "",
    codeBlock:
      step.codeBlock && step.codeBlock.content.length > 0
        ? {
            language: step.codeBlock.language.trim() || "bash",
            content: step.codeBlock.content,
          }
        : null,
    timerSeconds:
      typeof step.timerSeconds === "number" && step.timerSeconds > 0
        ? Math.floor(step.timerSeconds)
        : null,
    verificationCue: step.verificationCue?.trim() || null,
    rollbackHint: step.rollbackHint?.trim() || null,
    branchHint: step.branchHint?.trim() || null,
  }));
}

export class OperationService {
  private readonly database: AppDatabase;
  private readonly operations: OperationRepository;
  private readonly social: OperationsSocialRepository;
  private readonly habits: HabitRepository;
  private readonly tasks: TaskRepository;
  private readonly projects: ProjectRepository;
  private readonly reminders: ReminderRepository;
  private readonly users: UserRepository;
  private readonly workspace: WorkspaceRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly reminderService: ReminderService;
  private readonly rateLimiter: RateLimiter;
  private readonly now: () => number;

  constructor(deps: OperationServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.operations = deps.operations ?? operationRepository;
    this.social = deps.social ?? operationsSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.projects = deps.projects ?? projectRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.users = deps.users ?? userRepository;
    this.workspace = deps.workspace ?? workspaceRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    const eventBus: EventBus = deps.eventBus ?? defaultEventBus;
    this.reminderService =
      deps.reminderService ??
      new ReminderService({
        database: this.database,
        reminders: this.reminders,
        eventBus,
      });
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.now = deps.now ?? (() => Date.now());
  }

  private enforceSecretGate(params: {
    visibility: OperationVisibility;
    acknowledgeWarnings?: boolean;
    title: string;
    summary: string;
    variables: OperationVariable[];
    prerequisites: OperationPrerequisite[];
    steps: OperationStep[];
  }): SecretScanFinding[] {
    const scanReport = scanOperationForSecrets({
      title: params.title,
      summary: params.summary,
      variables: params.variables,
      prerequisites: params.prerequisites,
      steps: params.steps,
    });

    if (params.visibility === "public" || params.visibility === "unlisted") {
      if (scanReport.hasBlockers) {
        throw new SecretScanBlockedError(scanReport.blockers);
      }
      if (scanReport.hasWarnings && !params.acknowledgeWarnings) {
        throw new SecretScanWarningAckRequiredError(scanReport.warnings);
      }
    }

    return scanReport.warnings;
  }

  private validateAndNormalizeBlueprintInput(input: CreateOperationInput): {
    title: string;
    summary: string;
    tags: string[];
    variables: OperationVariable[];
    prerequisites: OperationPrerequisite[];
    steps: OperationStep[];
    visibility: OperationVisibility;
    referenceNoteIds: string[];
  } {
    const title = input.title.trim();
    if (!title || title.length > MAX_OPERATION_TITLE_LENGTH) {
      throw new ValidationError(
        `Title must be between 1 and ${MAX_OPERATION_TITLE_LENGTH} characters.`
      );
    }

    const summary = (input.summary ?? "").trim();
    if (summary.length > MAX_OPERATION_SUMMARY_LENGTH) {
      throw new ValidationError(
        `Summary must be at most ${MAX_OPERATION_SUMMARY_LENGTH} characters.`
      );
    }

    if (
      input.estimatedMinutes !== undefined &&
      input.estimatedMinutes !== null &&
      (!Number.isInteger(input.estimatedMinutes) ||
        input.estimatedMinutes < 1 ||
        input.estimatedMinutes > 10080)
    ) {
      throw new ValidationError(
        "Estimated duration must be between 1 and 10,080 minutes."
      );
    }

    if (
      input.reviewCycleDays !== undefined &&
      input.reviewCycleDays !== null &&
      (!Number.isInteger(input.reviewCycleDays) ||
        input.reviewCycleDays < 1 ||
        input.reviewCycleDays > 3650)
    ) {
      throw new ValidationError(
        "Review cycle must be between 1 and 3,650 days."
      );
    }

    const parsedVars = operationVariablesSchemaArray.safeParse(
      input.variables ?? []
    );
    if (!parsedVars.success) {
      throw new ValidationError(
        parsedVars.error.issues[0]?.message ?? "Invalid variable definition."
      );
    }

    const parsedPrereqs = operationPrerequisitesSchemaArray.safeParse(
      input.prerequisites ?? []
    );
    if (!parsedPrereqs.success) {
      throw new ValidationError(
        parsedPrereqs.error.issues[0]?.message ??
          "Invalid prerequisite definition."
      );
    }

    const parsedSteps = operationStepsSchemaArray.safeParse(input.steps);
    if (!parsedSteps.success) {
      throw new ValidationError(
        parsedSteps.error.issues[0]?.message ?? "Invalid step definition."
      );
    }

    const referenceNoteIds = Array.from(
      new Set((input.referenceNoteIds ?? []).filter(Boolean))
    );
    if (referenceNoteIds.length > MAX_REFERENCE_NOTES) {
      throw new ValidationError(
        `At most ${MAX_REFERENCE_NOTES} reference notes can be linked.`
      );
    }

    return {
      title,
      summary,
      tags: normalizeOperationTags(input.tags),
      variables: parsedVars.data,
      prerequisites: parsedPrereqs.data,
      steps: normalizeStepsWithPositions(parsedSteps.data),
      visibility: input.visibility ?? "private",
      referenceNoteIds,
    };
  }

  private async validateCrossModuleLinks(
    userId: string,
    links: {
      projectId?: string | null;
      linkedHabitId?: string | null;
      referenceNoteIds?: string[];
    },
    tx: DbExecutor
  ): Promise<{ projectId: string | null; linkedHabitId: string | null }> {
    let validProjectId: string | null = null;
    if (links.projectId) {
      await assertProjectRole(
        links.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        tx
      );
      validProjectId = links.projectId;
    }

    let validHabitId: string | null = null;
    if (links.linkedHabitId) {
      const habit = await this.habits.getHabitForUser(
        userId,
        links.linkedHabitId,
        tx
      );
      if (!habit) {
        throw new ForbiddenError("You can only link one of your own habits.");
      }
      validHabitId = habit.id;
    }

    if (links.referenceNoteIds && links.referenceNoteIds.length > 0) {
      const allReadable = await canUserReadAllNotes(
        userId,
        links.referenceNoteIds,
        tx
      );
      if (!allReadable) {
        throw new ForbiddenError(
          "One or more linked reference notes are not accessible."
        );
      }
    }

    return { projectId: validProjectId, linkedHabitId: validHabitId };
  }

  private async allocateUniqueSlug(
    title: string,
    tx: DbExecutor
  ): Promise<string> {
    const base = slugifyOperationTitle(title);
    const existing = await this.operations.findBySlug(base, tx);
    if (!existing) return base;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = randomBytes(3).toString("hex").slice(0, 5);
      const candidate = appendSlugSuffix(base, suffix);
      const taken = await this.operations.findBySlug(candidate, tx);
      if (!taken) return candidate;
    }

    return appendSlugSuffix(base, randomBytes(4).toString("hex"));
  }

  async getLinkOptions(userId: string): Promise<OperationLinkOptions> {
    return this.operations.listLinkOptionsForUser(userId);
  }

  private async loadLinkOptions(userId: string): Promise<OperationLinkOptions> {
    return this.operations.listLinkOptionsForUser(userId);
  }

  async createOperation(
    userId: string,
    input: CreateOperationInput
  ): Promise<OperationMutationResult> {
    const normalized = this.validateAndNormalizeBlueprintInput(input);
    const warnings = this.enforceSecretGate({
      visibility: normalized.visibility,
      acknowledgeWarnings: input.acknowledgeWarnings,
      title: normalized.title,
      summary: normalized.summary,
      variables: normalized.variables,
      prerequisites: normalized.prerequisites,
      steps: normalized.steps,
    });

    const unlisted =
      normalized.visibility === "unlisted" ? mintUnlistedToken() : null;
    const nowMs = this.now();

    const { operation, version, ownerHandle } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const { projectId, linkedHabitId } =
          await this.validateCrossModuleLinks(
            userId,
            {
              projectId: input.projectId,
              linkedHabitId: input.linkedHabitId,
              referenceNoteIds: normalized.referenceNoteIds,
            },
            tx
          );
        const ownerRow = await this.users.getById(userId, tx);

        const slug = await this.allocateUniqueSlug(normalized.title, tx);
        const created = await this.operations.createOperation(
          {
            ownerId: userId,
            projectId,
            linkedHabitId,
            slug,
            title: normalized.title,
            summary: normalized.summary,
            domain: input.domain,
            tagsJson: JSON.stringify(normalized.tags),
            difficulty: input.difficulty ?? null,
            estimatedMinutes: input.estimatedMinutes ?? null,
            visibility: normalized.visibility,
            unlistedTokenHash: unlisted?.tokenHash ?? null,
            allowForking: input.allowForking ?? true,
            shareWithProject: Boolean(projectId && input.shareWithProject),
            reviewCycleDays: input.reviewCycleDays ?? null,
            lastVerifiedAt: nowMs,
            nowMs,
          },
          tx
        );

        const createdVersion = await this.operations.createVersion(
          {
            operationId: created.id,
            versionNumber: 1,
            variablesSchemaJson: JSON.stringify(normalized.variables),
            prerequisitesJson: JSON.stringify(normalized.prerequisites),
            stepsSnapshotJson: JSON.stringify(normalized.steps),
            changeSummary: input.changeSummary?.trim() || "Initial version",
            createdById: userId,
            nowMs,
          },
          tx
        );

        if (normalized.referenceNoteIds.length > 0) {
          await this.operations.replaceReferenceNotes(
            created.id,
            normalized.referenceNoteIds,
            tx
          );
        }

        return {
          operation: created,
          version: createdVersion,
          ownerHandle: ownerRow?.handle ?? null,
        };
      })
    );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: warnings,
      mintedUnlistedToken: unlisted?.rawToken ?? null,
      ownerHandle,
    };
  }

  async publishNewVersion(
    userId: string,
    operationId: string,
    input: PublishOperationVersionInput
  ): Promise<OperationMutationResult> {
    if (
      !Number.isInteger(input.expectedEditVersion) ||
      input.expectedEditVersion < 1
    ) {
      throw new ValidationError("expectedEditVersion must be a positive integer.");
    }

    const normalized = this.validateAndNormalizeBlueprintInput(input);
    const nowMs = this.now();

    const {
      operation,
      version,
      mintedUnlistedToken,
      warnings,
      ownerHandle,
      affectsPublicCache,
      forkSlugs,
    } = await withDbRetry(() =>
        this.database.transaction(async (tx) => {
          const access = await resolveOperationAccess(
            { operationId, sessionUserId: userId },
            tx
          );
          assertOperationCapability(
            access,
            "canEditSteps",
            "Only owners and collaborators can edit operation steps."
          );

          const existing = access.operation;
          const isOwner = access.role === "owner";

          // Strictly block Collaborators from changing owner-only security controls!
          if (!isOwner) {
            if (
              input.visibility !== undefined &&
              input.visibility !== existing.visibility
            ) {
              throw new ForbiddenError(
                "Only the operation owner can change visibility."
              );
            }
            if (
              input.allowForking !== undefined &&
              input.allowForking !== existing.allowForking
            ) {
              throw new ForbiddenError(
                "Only the operation owner can change forking permissions."
              );
            }
            if (
              input.shareWithProject !== undefined &&
              input.shareWithProject !== existing.shareWithProject
            ) {
              throw new ForbiddenError(
                "Only the operation owner can change project sharing."
              );
            }
          }

          const effectiveVisibility = isOwner
            ? normalized.visibility
            : existing.visibility;

          const scanWarnings = this.enforceSecretGate({
            visibility: effectiveVisibility,
            acknowledgeWarnings: input.acknowledgeWarnings,
            title: normalized.title,
            summary: normalized.summary,
            variables: normalized.variables,
            prerequisites: normalized.prerequisites,
            steps: normalized.steps,
          });

          let projectId = existing.projectId;
          let linkedHabitId = existing.linkedHabitId;
          if (isOwner) {
            const validated = await this.validateCrossModuleLinks(
              userId,
              {
                projectId: input.projectId,
                linkedHabitId: input.linkedHabitId,
                referenceNoteIds:
                  input.referenceNoteIds !== undefined
                    ? normalized.referenceNoteIds
                    : undefined,
              },
              tx
            );
            projectId = validated.projectId;
            linkedHabitId = validated.linkedHabitId;
          }

          let nextUnlistedTokenHash = existing.unlistedTokenHash;
          let newRawToken: string | null = null;
          if (isOwner) {
            if (effectiveVisibility === "unlisted") {
              if (!existing.unlistedTokenHash) {
                const minted = mintUnlistedToken();
                nextUnlistedTokenHash = minted.tokenHash;
                newRawToken = minted.rawToken;
              }
            } else {
              nextUnlistedTokenHash = null;
            }
          }

          const nextShareWithProject = isOwner
            ? Boolean(
                projectId &&
                  (input.shareWithProject ?? existing.shareWithProject)
              )
            : existing.shareWithProject;

          const updated = await this.operations.updateOperationWithOptimisticLock(
            {
              operationId,
              expectedEditVersion: input.expectedEditVersion,
              incrementCurrentVersion: true,
              patch: {
                projectId,
                linkedHabitId,
                title: normalized.title,
                summary: normalized.summary,
                domain: input.domain,
                tagsJson: JSON.stringify(normalized.tags),
                difficulty: input.difficulty ?? null,
                estimatedMinutes: input.estimatedMinutes ?? null,
                visibility: effectiveVisibility,
                unlistedTokenHash: nextUnlistedTokenHash,
                allowForking: isOwner
                  ? (input.allowForking ?? existing.allowForking)
                  : existing.allowForking,
                shareWithProject: nextShareWithProject,
                reviewCycleDays: input.reviewCycleDays ?? null,
              },
              nowMs,
            },
            tx
          );

          if (!updated) {
            throw new ConcurrencyConflictError();
          }

          const createdVersion = await this.operations.createVersion(
            {
              operationId: updated.id,
              versionNumber: updated.currentVersion,
              variablesSchemaJson: JSON.stringify(normalized.variables),
              prerequisitesJson: JSON.stringify(normalized.prerequisites),
              stepsSnapshotJson: JSON.stringify(normalized.steps),
              changeSummary:
                input.changeSummary?.trim() ||
                `Published v${updated.currentVersion}`,
              createdById: userId,
              nowMs,
            },
            tx
          );

          if (isOwner && input.referenceNoteIds !== undefined) {
            await this.operations.replaceReferenceNotes(
              updated.id,
              normalized.referenceNoteIds,
              tx
            );
          }

          const ownerRow = await this.users.getById(updated.ownerId, tx);
          const forkSlugs =
            existing.visibility === "public" || updated.visibility === "public"
              ? await this.social.listPublicForkSlugs(updated.id, tx)
              : [];

          return {
            operation: updated,
            version: createdVersion,
            mintedUnlistedToken: newRawToken,
            warnings: scanWarnings,
            ownerHandle: ownerRow?.handle ?? null,
            affectsPublicCache:
              existing.visibility === "public" || updated.visibility === "public",
            forkSlugs,
          };
        })
      );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: warnings,
      mintedUnlistedToken,
      ownerHandle,
      affectsPublicCache,
      forkSlugs,
    };
  }

  /**
   * Owner-only 3-state visibility transition (`private` / `unlisted` / `public`)
   * with strict server-side Secret Scanner hard-block + warning acknowledgement gate.
   */
  async updateVisibility(
    userId: string,
    operationId: string,
    input: UpdateOperationVisibilityInput
  ): Promise<OperationVisibilityMutationResult> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          { operationId, sessionUserId: userId },
          tx
        );
        assertOperationCapability(
          access,
          "canChangeVisibility",
          "Only the operation owner can change visibility."
        );

        const existing = access.operation;
        const latestVersion = await this.operations.getLatestVersion(
          existing.id,
          tx
        );
        if (!latestVersion) {
          throw new NotFoundError("Operation has no published versions.");
        }

        const warnings = this.enforceSecretGate({
          visibility: input.visibility,
          acknowledgeWarnings: input.acknowledgeWarnings,
          title: existing.title,
          summary: existing.summary,
          variables: parseVariablesSchemaJson(latestVersion.variablesSchemaJson),
          prerequisites: parsePrerequisitesJson(latestVersion.prerequisitesJson),
          steps: parseStepsSnapshotJson(latestVersion.stepsSnapshotJson),
        });

        let nextHash = existing.unlistedTokenHash;
        let rawToken: string | null = null;
        if (input.visibility === "unlisted") {
          if (!existing.unlistedTokenHash) {
            const minted = mintUnlistedToken();
            nextHash = minted.tokenHash;
            rawToken = minted.rawToken;
          }
        } else {
          nextHash = null;
        }

        const updated = await this.operations.updateOperationSimple(
          existing.id,
          existing.ownerId,
          {
            visibility: input.visibility,
            unlistedTokenHash: nextHash,
            ...(input.allowForking !== undefined
              ? { allowForking: input.allowForking }
              : {}),
            updatedAt: nowMs,
          },
          tx
        );
        if (!updated) {
          throw new NotFoundError("Operation not found.");
        }

        const ownerRow = await this.users.getById(existing.ownerId, tx);
        const affectsPublicCache =
          existing.visibility === "public" || updated.visibility === "public";
        const forkSlugs = affectsPublicCache
          ? await this.social.listPublicForkSlugs(updated.id, tx)
          : [];
        return {
          operation: updated,
          secretScanWarnings: warnings,
          mintedUnlistedToken: rawToken,
          ownerHandle: ownerRow?.handle ?? null,
          affectsPublicCache,
          forkSlugs,
        };
      })
    );
  }

  /**
   * Owner-only rotation of the secret unlisted token (invalidates old link instantly).
   */
  async rotateUnlistedToken(
    userId: string,
    operationId: string
  ): Promise<{ operation: OperationRecord; mintedUnlistedToken: string }> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          { operationId, sessionUserId: userId },
          tx
        );
        assertOperationCapability(
          access,
          "canRotateUnlistedLink",
          "Only the operation owner can rotate the unlisted link."
        );

        if (access.operation.visibility !== "unlisted") {
          throw new ValidationError(
            "Switch visibility to Unlisted before rotating the secret link."
          );
        }

        const { rawToken, tokenHash } = mintUnlistedToken();
        const updated = await this.operations.updateOperationSimple(
          access.operation.id,
          access.operation.ownerId,
          {
            unlistedTokenHash: tokenHash,
            updatedAt: nowMs,
          },
          tx
        );
        if (!updated) {
          throw new NotFoundError("Operation not found.");
        }

        return { operation: updated, mintedUnlistedToken: rawToken };
      })
    );
  }

  /**
   * Owner-only opt-in Project Team sharing toggle.
   */
  async updateProjectSharing(
    userId: string,
    operationId: string,
    input: UpdateOperationProjectSharingInput
  ): Promise<OperationRecord> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          { operationId, sessionUserId: userId },
          tx
        );
        assertOperationCapability(
          access,
          "canManageSharing",
          "Only the operation owner can manage project sharing."
        );

        let validProjectId: string | null = null;
        if (input.projectId) {
          await assertProjectRole(
            input.projectId,
            userId,
            ["owner", "editor"],
            this.membershipLookup,
            tx
          );
          validProjectId = input.projectId;
        }

        const updated = await this.operations.updateOperationSimple(
          access.operation.id,
          access.operation.ownerId,
          {
            projectId: validProjectId,
            shareWithProject: Boolean(validProjectId && input.shareWithProject),
            updatedAt: nowMs,
          },
          tx
        );
        if (!updated) {
          throw new NotFoundError("Operation not found.");
        }
        return updated;
      })
    );
  }

  /**
   * Clones any readable operation (when `allowForking === true` or owned by caller)
   * into a new Private operation with `forkedFromId` attribution and atomically
   * increments `source.forkCount`.
   */
  async forkOperation(
    userId: string,
    sourceOperationId: string,
    unlistedToken?: string | null
  ): Promise<{
    forked: OperationRecord;
    sourceSlug: string;
    sourceOwnerHandle: string | null;
    newForkCount: number;
  }> {
    const rate = await this.rateLimiter.limit("operation_fork", userId);
    if (!rate.allowed) {
      throw new RateLimitError({
        message: `Fork limit reached. Retry in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
        limit: rate.limit,
        remaining: rate.remaining,
        resetAtMs: rate.resetAtMs,
      });
    }

    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          {
            operationId: sourceOperationId,
            sessionUserId: userId,
            unlistedToken,
          },
          tx
        );
        assertOperationCapability(
          access,
          "canFork",
          "Forking is disabled on this operation."
        );

        const source = access.operation;
        const latestVersion = await this.operations.getLatestVersion(
          source.id,
          tx
        );
        if (!latestVersion) {
          throw new NotFoundError("Source operation has no published versions.");
        }

        const slug = await this.allocateUniqueSlug(source.title, tx);
        const forked = await this.operations.createOperation(
          {
            ownerId: userId,
            projectId: null,
            linkedHabitId: null,
            slug,
            title: source.title,
            summary: source.summary,
            domain: source.domain,
            tagsJson: source.tagsJson,
            difficulty: source.difficulty,
            estimatedMinutes: source.estimatedMinutes,
            visibility: "private",
            unlistedTokenHash: null,
            allowForking: true,
            shareWithProject: false,
            forkedFromId: source.id,
            reviewCycleDays: source.reviewCycleDays,
            lastVerifiedAt: nowMs,
            nowMs,
          },
          tx
        );

        await this.operations.createVersion(
          {
            operationId: forked.id,
            versionNumber: 1,
            variablesSchemaJson: latestVersion.variablesSchemaJson,
            prerequisitesJson: latestVersion.prerequisitesJson,
            stepsSnapshotJson: latestVersion.stepsSnapshotJson,
            changeSummary: `Forked from "${source.title}" (v${latestVersion.versionNumber})`,
            createdById: userId,
            nowMs,
          },
          tx
        );

        const newForkCount = await this.operations.incrementForkCount(
          source.id,
          tx
        );
        const sourceOwner = await this.users.getById(source.ownerId, tx);

        return {
          forked,
          sourceSlug: source.slug,
          sourceOwnerHandle: sourceOwner?.handle ?? null,
          newForkCount,
        };
      })
    );
  }

  async rollbackToVersion(
    userId: string,
    operationId: string,
    input: RollbackOperationVersionInput
  ): Promise<OperationMutationResult> {
    if (
      !Number.isInteger(input.targetVersionNumber) ||
      input.targetVersionNumber < 1
    ) {
      throw new ValidationError("Target version number must be >= 1.");
    }
    if (
      !Number.isInteger(input.expectedEditVersion) ||
      input.expectedEditVersion < 1
    ) {
      throw new ValidationError("expectedEditVersion must be >= 1.");
    }

    const nowMs = this.now();

    const { operation, version, warnings, ownerHandle } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const access = await resolveOperationAccess(
          { operationId, sessionUserId: userId },
          tx
        );
        assertOperationCapability(
          access,
          "canRollback",
          "Only owners and collaborators can roll back operation versions."
        );

        const existing = access.operation;
        const targetVersion = await this.operations.getVersionByNumber(
          operationId,
          input.targetVersionNumber,
          tx
        );
        if (!targetVersion) {
          throw new NotFoundError(
            `Version v${input.targetVersionNumber} was not found.`
          );
        }

        const scanWarnings = this.enforceSecretGate({
          visibility: existing.visibility,
          acknowledgeWarnings: input.acknowledgeWarnings ?? false,
          title: existing.title,
          summary: existing.summary,
          variables: parseVariablesSchemaJson(targetVersion.variablesSchemaJson),
          prerequisites: parsePrerequisitesJson(targetVersion.prerequisitesJson),
          steps: parseStepsSnapshotJson(targetVersion.stepsSnapshotJson),
        });

        const updated = await this.operations.updateOperationWithOptimisticLock(
          {
            operationId,
            expectedEditVersion: input.expectedEditVersion,
            incrementCurrentVersion: true,
            patch: {},
            nowMs,
          },
          tx
        );

        if (!updated) {
          throw new ConcurrencyConflictError();
        }

        const createdVersion = await this.operations.createVersion(
          {
            operationId: updated.id,
            versionNumber: updated.currentVersion,
            variablesSchemaJson: targetVersion.variablesSchemaJson,
            prerequisitesJson: targetVersion.prerequisitesJson,
            stepsSnapshotJson: targetVersion.stepsSnapshotJson,
            changeSummary:
              input.changeSummary?.trim() ||
              `Rolled back to v${input.targetVersionNumber}`,
            createdById: userId,
            nowMs,
          },
          tx
        );

        const ownerRow = await this.users.getById(updated.ownerId, tx);

        return {
          operation: updated,
          version: createdVersion,
          warnings: scanWarnings,
          ownerHandle: ownerRow?.handle ?? null,
        };
      })
    );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: warnings,
      mintedUnlistedToken: null,
      ownerHandle,
    };
  }

  async archiveOperation(
    userId: string,
    operationId: string,
    isArchived: boolean
  ): Promise<{ operation: OperationRecord; ownerHandle: string | null }> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canDelete",
      "Only the operation owner can archive or restore this operation."
    );
    const updated = await withDbRetry(() =>
      this.operations.updateOperationSimple(operationId, access.operation.ownerId, {
        isArchived,
        updatedAt: this.now(),
      })
    );
    if (!updated) {
      throw new NotFoundError("Operation not found.");
    }
    const ownerRow = await this.users.getById(access.operation.ownerId);
    return { operation: updated, ownerHandle: ownerRow?.handle ?? null };
  }

  async deleteOperation(
    userId: string,
    operationId: string
  ): Promise<{
    slug: string;
    ownerHandle: string | null;
    wasPublic: boolean;
    forkSlugs: string[];
  }> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canDelete",
      "Only the operation owner can delete this operation."
    );
    const wasPublic = access.operation.visibility === "public";
    const [ownerRow, forkSlugs] = await Promise.all([
      this.users.getById(access.operation.ownerId),
      wasPublic
        ? this.social.listPublicForkSlugs(access.operation.id)
        : Promise.resolve([]),
    ]);
    const deleted = await withDbRetry(() =>
      this.operations.deleteOperationForOwner(
        operationId,
        access.operation.ownerId
      )
    );
    if (!deleted) {
      throw new NotFoundError("Operation not found.");
    }
    return {
      slug: access.operation.slug,
      ownerHandle: ownerRow?.handle ?? null,
      wasPublic,
      forkSlugs,
    };
  }

  async markVerified(
    userId: string,
    operationId: string
  ): Promise<{ operation: OperationRecord; ownerHandle: string | null }> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    assertOperationCapability(
      access,
      "canEditSteps",
      "Only owners and collaborators can mark this operation verified."
    );
    const nowMs = this.now();
    const updated = await withDbRetry(() =>
      this.operations.updateOperationSimple(operationId, access.operation.ownerId, {
        lastVerifiedAt: nowMs,
        updatedAt: nowMs,
      })
    );
    if (!updated) {
      throw new NotFoundError("Operation not found.");
    }
    const ownerRow = await this.users.getById(access.operation.ownerId);
    return { operation: updated, ownerHandle: ownerRow?.handle ?? null };
  }

  async listOperationsHub(
    userId: string,
    filters: {
      includeArchived?: boolean;
      domain?: OperationDomain;
      query?: string;
    } = {}
  ): Promise<OperationsHubPayload> {
    const nowMs = this.now();
    const userRow = await this.users.getById(userId);
    const [opRows, allRuns, sharedWithMe, pendingInvitations, exploreOperations, linkOptions] =
      await Promise.all([
        this.operations.listForOwner(userId, {
          includeArchived: filters.includeArchived,
          domain: filters.domain,
        }),
        this.operations.listRunsForUser(userId, { limit: 40 }),
        this.social.listSharedWithUser(userId),
        userRow
          ? this.social.listPendingInvitationsForUser(
              userId,
              userRow.email,
              nowMs
            )
          : Promise.resolve([]),
        this.database === db
          ? getCachedPublicExploreOperations({
              domain: filters.domain,
            }).then((rows) => rows.slice(0, 30))
          : this.social.listPublicExploreOperations({
              domain: filters.domain,
              limit: 30,
            }),
        this.loadLinkOptions(userId),
      ]);

    const searchTerm = filters.query?.trim().toLowerCase() ?? "";
    const hydratedOps: HydratedOperationListItem[] = opRows
      .map((row) => ({
        ...row,
        tags: parseOperationTagsJson(row.operation.tagsJson),
        staleness: computeOperationStaleness({
          reviewCycleDays: row.operation.reviewCycleDays,
          lastVerifiedAt: row.operation.lastVerifiedAt,
          createdAt: row.operation.createdAt,
          nowMs,
        }),
      }))
      .filter((row) => {
        if (!searchTerm) return true;
        return (
          row.operation.title.toLowerCase().includes(searchTerm) ||
          row.operation.summary.toLowerCase().includes(searchTerm) ||
          row.tags.some((t) => t.includes(searchTerm))
        );
      });

    const activeRuns = allRuns.filter((r) => r.run.status === "in_progress");
    const recentRuns = allRuns.filter((r) => r.run.status !== "in_progress");

    return {
      operations: hydratedOps,
      activeRuns,
      recentRuns,
      sharedWithMe,
      pendingInvitations,
      exploreOperations,
      linkOptions,
    };
  }

  async getOperationDetail(
    userId: string,
    operationId: string
  ): Promise<OperationDetailPayload> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    const { operation } = access;
    const isOwner = access.role === "owner";

    const [
      versionsRaw,
      referenceNotes,
      recentRuns,
      openFlags,
      ownerRow,
      linkOptions,
    ] = await Promise.all([
      this.operations.listVersionsForOperation(operation.id),
      isOwner
        ? this.operations.listReferenceNotesForOperation(operation.id)
        : Promise.resolve([]),
      // Strictly scoped to `runnerId === userId` — viewers/collaborators NEVER see other users' runs!
      this.operations.listRunsForUser(userId, {
        operationId: operation.id,
        limit: 15,
      }),
      access.capabilities.canResolveFlags
        ? this.social.listFlagsForOperation(operation.id, "open")
        : Promise.resolve([]),
      this.users.getById(operation.ownerId),
      isOwner
        ? this.loadLinkOptions(userId)
        : Promise.resolve({ projects: [], habits: [], notes: [] }),
    ]);

    if (versionsRaw.length === 0) {
      throw new NotFoundError("Operation has no published versions.");
    }

    const versions = versionsRaw.map(hydrateVersion);
    const currentVersion =
      versions.find((v) => v.versionNumber === operation.currentVersion) ??
      versions[0]!;

    const matchedProject =
      isOwner && operation.projectId
        ? linkOptions.projects.find((p) => p.id === operation.projectId)
        : undefined;
    const linkedProject: { id: string; name: string; colorToken: string } | null =
      matchedProject
        ? matchedProject
        : isOwner && operation.projectId
          ? await this.projects
              .getProjectById(operation.projectId)
              .then((p) =>
                p ? { id: p.id, name: p.name, colorToken: p.colorToken } : null
              )
          : null;

    const matchedHabit =
      isOwner && operation.linkedHabitId
        ? linkOptions.habits.find((h) => h.id === operation.linkedHabitId)
        : undefined;
    const linkedHabit: { id: string; title: string } | null = matchedHabit
      ? { id: matchedHabit.id, title: matchedHabit.title }
      : isOwner && operation.linkedHabitId
        ? await this.habits
            .getHabitForUser(userId, operation.linkedHabitId)
            .then((h) => (h ? { id: h.id, title: h.title } : null))
        : null;

    // Strip sensitive tokenHash before returning to non-owners
    const safeOperation: OperationRecord = isOwner
      ? operation
      : { ...operation, unlistedTokenHash: null };

    return {
      operation: safeOperation,
      tags: parseOperationTagsJson(operation.tagsJson),
      staleness: computeOperationStaleness({
        reviewCycleDays: operation.reviewCycleDays,
        lastVerifiedAt: operation.lastVerifiedAt,
        createdAt: operation.createdAt,
        nowMs: this.now(),
      }),
      access: {
        role: access.role,
        accessSource: access.accessSource,
        capabilities: access.capabilities,
      },
      owner: {
        id: operation.ownerId,
        name: ownerRow?.name ?? "Creator",
        handle: ownerRow?.handle ?? null,
      },
      currentVersion,
      versions,
      referenceNotes,
      recentRuns,
      openFlags,
      linkedProject,
      linkedHabit,
      linkOptions,
    };
  }

  async scheduleOperationRunTask(
    userId: string,
    operationId: string,
    input: ScheduleOperationRunTaskInput
  ): Promise<{ task: TaskRecord; reminder: ReminderRecord | null }> {
    const access = await resolveOperationAccess(
      { operationId, sessionUserId: userId },
      this.database
    );
    const { operation } = access;

    const taskTitle =
      input.title?.trim() || `Run Operation: ${operation.title}`;
    if (taskTitle.length > 200) {
      throw new ValidationError("Task title must be at most 200 characters.");
    }

    const { task, reminder, shouldDispatch } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        let targetProjectId: string | null = null;
        if (operation.projectId) {
          const membership = await this.membershipLookup.findMembership(
            operation.projectId,
            userId,
            tx
          );
          if (
            membership &&
            (membership.role === "owner" || membership.role === "editor")
          ) {
            targetProjectId = operation.projectId;
          }
        }

        const scope: TaskScope = targetProjectId
          ? { kind: "project", projectId: targetProjectId }
          : { kind: "personal", userId };

        const lastPos = await this.tasks.getLastPositionForScope(scope, tx);
        let position = generatePositionBetween(lastPos, null);
        if (position.length > MAX_POSITION_KEY_LENGTH) {
          await this.tasks.rebalancePositions(scope, tx);
          const refreshedLast = await this.tasks.getLastPositionForScope(
            scope,
            tx
          );
          position = generatePositionBetween(refreshedLast, null);
        }

        const createdTask = await this.tasks.create(
          {
            userId,
            projectId: targetProjectId,
            operationId: operation.id,
            title: taskTitle,
            description: operation.summary || null,
            priority: input.priority ?? "medium",
            dueAt: input.dueAt ?? input.remindAt ?? null,
            position,
          },
          tx
        );

        let createdReminder: ReminderRecord | null = null;
        let dispatchNeeded = false;
        if (
          typeof input.remindAt === "number" &&
          Number.isFinite(input.remindAt)
        ) {
          const remResult = await this.reminderService.createInTransaction(
            tx,
            userId,
            {
              taskId: createdTask.id,
              remindAt: input.remindAt,
              timezone: input.timezone,
            }
          );
          createdReminder = remResult.reminder;
          dispatchNeeded = remResult.shouldDispatch;
        }

        return {
          task: createdTask,
          reminder: createdReminder,
          shouldDispatch: dispatchNeeded,
        };
      })
    );

    if (reminder && shouldDispatch) {
      await this.reminderService.dispatchScheduledReminder(reminder);
    }

    return { task, reminder };
  }
}

export const operationService = new OperationService();
