import { createHash, randomBytes } from "node:crypto";
import {
  generateEvenPositions,
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  assertProjectRole,
  canUserReadEntity,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConcurrencyConflictError,
  ForbiddenError,
  NotFoundError,
  SecretScanBlockedError,
  ValidationError,
} from "@/server/dal/errors";
import { habitRepository, type HabitRepository } from "@/server/dal/habits";
import {
  assertOperationAccess,
  operationRepository,
  type OperationListRow,
  type OperationReferenceNoteSummary,
  type OperationRepository,
  type OperationRunListRow,
} from "@/server/dal/operations";
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
  type SecretScanFinding,
} from "@/server/domain/operations";
import { defaultEventBus, type EventBus } from "@/server/providers/event-bus";
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
  linkOptions: OperationLinkOptions;
}

export interface OperationDetailPayload {
  operation: OperationRecord;
  tags: string[];
  staleness: OperationStalenessInfo;
  currentVersion: HydratedOperationVersion;
  versions: HydratedOperationVersion[];
  referenceNotes: OperationReferenceNoteSummary[];
  recentRuns: OperationRunListRow[];
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
  reviewCycleDays?: number | null;
  projectId?: string | null;
  linkedHabitId?: string | null;
  referenceNoteIds?: string[];
  variables?: OperationVariable[];
  prerequisites?: OperationPrerequisite[];
  steps: OperationStep[];
  changeSummary?: string | null;
}

export interface PublishOperationVersionInput extends CreateOperationInput {
  expectedEditVersion: number;
}

export interface RollbackOperationVersionInput {
  targetVersionNumber: number;
  expectedEditVersion: number;
  changeSummary?: string | null;
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
}

export interface OperationServiceDeps {
  database?: AppDatabase;
  operations?: OperationRepository;
  habits?: HabitRepository;
  tasks?: TaskRepository;
  projects?: ProjectRepository;
  reminders?: ReminderRepository;
  workspace?: WorkspaceRepository;
  membershipLookup?: ProjectMembershipLookup;
  reminderService?: ReminderService;
  eventBus?: EventBus;
  now?: () => number;
}

function hashUnlistedToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function mintUnlistedToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashUnlistedToken(rawToken),
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
  private readonly habits: HabitRepository;
  private readonly tasks: TaskRepository;
  private readonly projects: ProjectRepository;
  private readonly reminders: ReminderRepository;
  private readonly workspace: WorkspaceRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly reminderService: ReminderService;
  private readonly now: () => number;

  constructor(deps: OperationServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.operations = deps.operations ?? operationRepository;
    this.habits = deps.habits ?? habitRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.projects = deps.projects ?? projectRepository;
    this.reminders = deps.reminders ?? reminderRepository;
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
    this.now = deps.now ?? (() => Date.now());
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
      for (const noteId of links.referenceNoteIds) {
        const readable = await canUserReadEntity(userId, { noteId }, tx);
        if (!readable) {
          throw new ForbiddenError(
            "One or more linked reference notes are not accessible."
          );
        }
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

  private async loadLinkOptions(userId: string): Promise<OperationLinkOptions> {
    const [sidebar, habitRows, noteRows] = await Promise.all([
      this.workspace.getSidebarSummary(userId, "UTC"),
      this.habits.listHabitsForUser(userId, { includeArchived: false }),
      this.workspace.listNotes(userId),
    ]);

    return {
      projects: sidebar.projects
        .filter((p) => p.role === "owner" || p.role === "editor")
        .map((p) => ({ id: p.id, name: p.name, colorToken: p.colorToken })),
      habits: habitRows.map((h) => ({
        id: h.id,
        title: h.title,
        category: h.category,
      })),
      notes: noteRows.map((n) => ({
        id: n.id,
        title: n.title,
        projectId: n.projectId,
      })),
    };
  }

  async createOperation(
    userId: string,
    input: CreateOperationInput
  ): Promise<OperationMutationResult> {
    const normalized = this.validateAndNormalizeBlueprintInput(input);
    const scanReport = scanOperationForSecrets({
      title: normalized.title,
      summary: normalized.summary,
      variables: normalized.variables,
      prerequisites: normalized.prerequisites,
      steps: normalized.steps,
    });

    if (
      (normalized.visibility === "public" ||
        normalized.visibility === "unlisted") &&
      scanReport.hasBlockers
    ) {
      throw new SecretScanBlockedError(scanReport.blockers);
    }

    const unlisted =
      normalized.visibility === "unlisted" ? mintUnlistedToken() : null;
    const nowMs = this.now();

    const { operation, version } = await withDbRetry(() =>
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

        return { operation: created, version: createdVersion };
      })
    );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: scanReport.warnings,
      mintedUnlistedToken: unlisted?.rawToken ?? null,
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
    const scanReport = scanOperationForSecrets({
      title: normalized.title,
      summary: normalized.summary,
      variables: normalized.variables,
      prerequisites: normalized.prerequisites,
      steps: normalized.steps,
    });

    if (
      (normalized.visibility === "public" ||
        normalized.visibility === "unlisted") &&
      scanReport.hasBlockers
    ) {
      throw new SecretScanBlockedError(scanReport.blockers);
    }

    const nowMs = this.now();

    const { operation, version, mintedUnlistedToken } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const { operation: existing } = await assertOperationAccess(
          operationId,
          userId,
          ["owner"],
          tx
        );

        const { projectId, linkedHabitId } =
          await this.validateCrossModuleLinks(
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

        let nextUnlistedTokenHash = existing.unlistedTokenHash;
        let newRawToken: string | null = null;
        if (normalized.visibility === "unlisted") {
          if (!existing.unlistedTokenHash) {
            const minted = mintUnlistedToken();
            nextUnlistedTokenHash = minted.tokenHash;
            newRawToken = minted.rawToken;
          }
        } else {
          nextUnlistedTokenHash = null;
        }

        const updated = await this.operations.updateOperationWithOptimisticLock(
          {
            operationId,
            ownerId: userId,
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
              visibility: normalized.visibility,
              unlistedTokenHash: nextUnlistedTokenHash,
              allowForking: input.allowForking ?? existing.allowForking,
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
              input.changeSummary?.trim() || `Published v${updated.currentVersion}`,
            createdById: userId,
            nowMs,
          },
          tx
        );

        if (input.referenceNoteIds !== undefined) {
          await this.operations.replaceReferenceNotes(
            updated.id,
            normalized.referenceNoteIds,
            tx
          );
        }

        return {
          operation: updated,
          version: createdVersion,
          mintedUnlistedToken: newRawToken,
        };
      })
    );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: scanReport.warnings,
      mintedUnlistedToken,
    };
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

    const { operation, version, warnings } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const { operation: existing } = await assertOperationAccess(
          operationId,
          userId,
          ["owner"],
          tx
        );

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

        const scanReport = scanOperationForSecrets({
          title: existing.title,
          summary: existing.summary,
          variables: parseVariablesSchemaJson(targetVersion.variablesSchemaJson),
          prerequisites: parsePrerequisitesJson(targetVersion.prerequisitesJson),
          steps: parseStepsSnapshotJson(targetVersion.stepsSnapshotJson),
        });

        if (
          (existing.visibility === "public" ||
            existing.visibility === "unlisted") &&
          scanReport.hasBlockers
        ) {
          throw new SecretScanBlockedError(
            scanReport.blockers,
            "Rollback blocked: target version contains detected secrets while this blueprint is shared."
          );
        }

        const updated = await this.operations.updateOperationWithOptimisticLock(
          {
            operationId,
            ownerId: userId,
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

        return {
          operation: updated,
          version: createdVersion,
          warnings: scanReport.warnings,
        };
      })
    );

    return {
      operation,
      version: hydrateVersion(version),
      secretScanWarnings: warnings,
      mintedUnlistedToken: null,
    };
  }

  async archiveOperation(
    userId: string,
    operationId: string,
    isArchived: boolean
  ): Promise<OperationRecord> {
    await assertOperationAccess(operationId, userId, ["owner"], this.database);
    const updated = await withDbRetry(() =>
      this.operations.updateOperationSimple(operationId, userId, {
        isArchived,
        updatedAt: this.now(),
      })
    );
    if (!updated) {
      throw new NotFoundError("Operation not found.");
    }
    return updated;
  }

  async deleteOperation(userId: string, operationId: string): Promise<void> {
    await assertOperationAccess(operationId, userId, ["owner"], this.database);
    const deleted = await withDbRetry(() =>
      this.operations.deleteOperationForOwner(operationId, userId)
    );
    if (!deleted) {
      throw new NotFoundError("Operation not found.");
    }
  }

  async markVerified(
    userId: string,
    operationId: string
  ): Promise<OperationRecord> {
    await assertOperationAccess(operationId, userId, ["owner"], this.database);
    const nowMs = this.now();
    const updated = await withDbRetry(() =>
      this.operations.updateOperationSimple(operationId, userId, {
        lastVerifiedAt: nowMs,
        updatedAt: nowMs,
      })
    );
    if (!updated) {
      throw new NotFoundError("Operation not found.");
    }
    return updated;
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
    const [opRows, allRuns, linkOptions] = await Promise.all([
      this.operations.listForOwner(userId, {
        includeArchived: filters.includeArchived,
        domain: filters.domain,
      }),
      this.operations.listRunsForUser(userId, { limit: 40 }),
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
      linkOptions,
    };
  }

  async getOperationDetail(
    userId: string,
    operationId: string
  ): Promise<OperationDetailPayload> {
    const { operation } = await assertOperationAccess(
      operationId,
      userId,
      ["owner"],
      this.database
    );

    const [versionsRaw, referenceNotes, recentRuns, linkOptions] =
      await Promise.all([
        this.operations.listVersionsForOperation(operation.id),
        this.operations.listReferenceNotesForOperation(operation.id),
        this.operations.listRunsForUser(userId, {
          operationId: operation.id,
          limit: 15,
        }),
        this.loadLinkOptions(userId),
      ]);

    if (versionsRaw.length === 0) {
      throw new NotFoundError("Operation has no published versions.");
    }

    const versions = versionsRaw.map(hydrateVersion);
    const currentVersion =
      versions.find((v) => v.versionNumber === operation.currentVersion) ??
      versions[0]!;

    const matchedProject = operation.projectId
      ? linkOptions.projects.find((p) => p.id === operation.projectId)
      : undefined;
    const linkedProject: { id: string; name: string; colorToken: string } | null =
      matchedProject
        ? matchedProject
        : operation.projectId
          ? await this.projects
              .getProjectById(operation.projectId)
              .then((p) =>
                p ? { id: p.id, name: p.name, colorToken: p.colorToken } : null
              )
          : null;

    const matchedHabit = operation.linkedHabitId
      ? linkOptions.habits.find((h) => h.id === operation.linkedHabitId)
      : undefined;
    const linkedHabit: { id: string; title: string } | null = matchedHabit
      ? { id: matchedHabit.id, title: matchedHabit.title }
      : operation.linkedHabitId
        ? await this.habits
            .getHabitForUser(userId, operation.linkedHabitId)
            .then((h) => (h ? { id: h.id, title: h.title } : null))
        : null;

    return {
      operation,
      tags: parseOperationTagsJson(operation.tagsJson),
      staleness: computeOperationStaleness({
        reviewCycleDays: operation.reviewCycleDays,
        lastVerifiedAt: operation.lastVerifiedAt,
        createdAt: operation.createdAt,
        nowMs: this.now(),
      }),
      currentVersion,
      versions,
      referenceNotes,
      recentRuns,
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
    const { operation } = await assertOperationAccess(
      operationId,
      userId,
      ["owner"],
      this.database
    );

    const taskTitle =
      input.title?.trim() || `Run Operation: ${operation.title}`;
    if (taskTitle.length > 200) {
      throw new ValidationError("Task title must be at most 200 characters.");
    }

    const { task, reminder, shouldDispatch } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        // Attach to operation.projectId only if user still holds write access.
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
        if (typeof input.remindAt === "number" && Number.isFinite(input.remindAt)) {
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

    // Post-commit dispatch ONLY — zero external I/O inside db.transaction()!
    if (reminder && shouldDispatch) {
      await this.reminderService.dispatchScheduledReminder(reminder);
    }

    return { task, reminder };
  }
}

export const operationService = new OperationService();
