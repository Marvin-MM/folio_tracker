import {
  generatePositionBetween,
  MAX_POSITION_KEY_LENGTH,
} from "@/lib/fractional-index";
import {
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { habitRepository, type HabitRepository } from "@/server/dal/habits";
import {
  assertOperationCapability,
  resolveOperationAccess,
} from "@/server/dal/operation-auth";
import {
  operationRepository,
  type OperationReferenceNoteSummary,
  type OperationRepository,
} from "@/server/dal/operations";
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
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type {
  OperationDomain,
  OperationRecord,
  OperationRunRecord,
  OperationRunStepRecord,
  OperationRunStepStatus,
  ReminderRecord,
  TaskPriority,
  TaskRecord,
} from "@/server/db/schema";
import { getLocalDateKey } from "@/server/domain/habit-analytics";
import { evaluateMonthLockState } from "@/server/domain/habit-month-lock";
import {
  MAX_RUN_STEP_NOTE_LENGTH,
  parsePrerequisitesJson,
  parseStepsSnapshotJson,
  parseStringArrayJson,
  parseVariablesSchemaJson,
  parseVariableValuesJson,
  stripSecretVariables,
  type OperationPrerequisite,
  type OperationStep,
  type OperationVariable,
} from "@/server/domain/operations";
import { defaultEventBus, type EventBus } from "@/server/providers/event-bus";
import { ReminderService } from "./reminder-service";

export interface OperationRunDetailPayload {
  run: OperationRunRecord;
  operation: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    domain: OperationDomain;
    projectId: string | null;
    linkedHabitId: string | null;
    linkedHabitTitle: string | null;
    currentVersion: number;
    ownerId: string;
  };
  pinnedVersion: {
    id: string;
    versionNumber: number;
    changeSummary: string | null;
    createdAt: number;
    variables: OperationVariable[];
    prerequisites: OperationPrerequisite[];
    steps: OperationStep[];
  };
  variablesValues: Record<string, string>;
  prerequisitesChecked: string[];
  stepStates: OperationRunStepRecord[];
  referenceNotes: OperationReferenceNoteSummary[];
}

export interface StartOperationRunInput {
  title?: string;
  variablesValues?: Record<string, string>;
  prerequisitesChecked?: string[];
  unlistedToken?: string | null;
}

export interface UpdateRunPreflightInput {
  title?: string;
  variablesValues?: Record<string, string>;
  prerequisitesChecked?: string[];
}

export interface UpdateRunStepInput {
  stepKey: string;
  status: OperationRunStepStatus;
  note?: string | null;
}

export interface SyncOfflineRunMutationsInput {
  preflight?: UpdateRunPreflightInput;
  stepUpdates?: UpdateRunStepInput[];
}

export interface CompleteRunInput {
  markOperationVerified?: boolean;
  autoLogLinkedHabit?: boolean;
  timezone?: string;
}

export interface CompleteRunResult {
  run: OperationRunRecord;
  verifiedUpdated: boolean;
  habitAutoLogged: {
    habitId: string;
    habitTitle: string;
    dateKey: string;
  } | null;
  habitAutoLogSkippedReason: string | null;
}

export interface CreateBlockedStepTaskInput {
  stepKey: string;
  title?: string;
  description?: string | null;
  dueAt?: number | null;
  remindAt?: number | null;
  priority?: TaskPriority;
  timezone: string;
  markStepBlocked?: boolean;
}

export interface OperationRunServiceDeps {
  database?: AppDatabase;
  operations?: OperationRepository;
  habits?: HabitRepository;
  tasks?: TaskRepository;
  reminders?: ReminderRepository;
  users?: UserRepository;
  membershipLookup?: ProjectMembershipLookup;
  reminderService?: ReminderService;
  eventBus?: EventBus;
  now?: () => number;
}

export class OperationRunService {
  private readonly database: AppDatabase;
  private readonly operations: OperationRepository;
  private readonly habits: HabitRepository;
  private readonly tasks: TaskRepository;
  private readonly reminders: ReminderRepository;
  private readonly users: UserRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly reminderService: ReminderService;
  private readonly now: () => number;

  constructor(deps: OperationRunServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.operations = deps.operations ?? operationRepository;
    this.habits = deps.habits ?? habitRepository;
    this.tasks = deps.tasks ?? taskRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.users = deps.users ?? userRepository;
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

  private filterCheckedPrerequisites(
    checked: readonly string[] | undefined,
    prerequisites: readonly OperationPrerequisite[]
  ): string[] {
    if (!checked || checked.length === 0) return [];
    const validIds = new Set(prerequisites.map((p) => p.id));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of checked) {
      if (validIds.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  private async assembleRunDetail(
    userId: string,
    run: OperationRunRecord
  ): Promise<OperationRunDetailPayload> {
    const [operation, pinnedVersionRow, stepStates, referenceNotes] =
      await Promise.all([
        this.operations.getById(run.operationId),
        this.operations.getVersionById(run.versionId),
        this.operations.listRunSteps(run.id),
        this.operations.listReferenceNotesForOperation(run.operationId),
      ]);

    if (!operation || !pinnedVersionRow) {
      throw new NotFoundError("Operation run version is no longer available.");
    }

    const linkedHabit = operation.linkedHabitId
      ? await this.habits.getHabitForUser(userId, operation.linkedHabitId)
      : null;

    const variables = parseVariablesSchemaJson(
      pinnedVersionRow.variablesSchemaJson
    );
    const prerequisites = parsePrerequisitesJson(
      pinnedVersionRow.prerequisitesJson
    );
    const steps = parseStepsSnapshotJson(pinnedVersionRow.stepsSnapshotJson);

    // Defense-in-depth: re-strip any secret keys even on read.
    const safeValues = stripSecretVariables(
      parseVariableValuesJson(run.variablesValuesJson),
      variables
    );

    return {
      run,
      operation: {
        id: operation.id,
        slug: operation.slug,
        title: operation.title,
        summary: operation.summary,
        domain: operation.domain,
        projectId: operation.projectId,
        linkedHabitId: linkedHabit && !linkedHabit.isArchived ? linkedHabit.id : null,
        linkedHabitTitle:
          linkedHabit && !linkedHabit.isArchived ? linkedHabit.title : null,
        currentVersion: operation.currentVersion,
        ownerId: operation.ownerId,
      },
      pinnedVersion: {
        id: pinnedVersionRow.id,
        versionNumber: pinnedVersionRow.versionNumber,
        changeSummary: pinnedVersionRow.changeSummary,
        createdAt: pinnedVersionRow.createdAt,
        variables,
        prerequisites,
        steps,
      },
      variablesValues: safeValues,
      prerequisitesChecked: parseStringArrayJson(run.prerequisitesCheckedJson),
      stepStates,
      referenceNotes,
    };
  }

  async startRun(
    userId: string,
    operationId: string,
    input: StartOperationRunInput = {}
  ): Promise<OperationRunDetailPayload> {
    const nowMs = this.now();

    const createdRun = await withDbRetry(() =>
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
          "canSaveRun",
          "You do not have permission to start a saved run on this operation."
        );
        const { operation } = access;

        const latestVersion = await this.operations.getLatestVersion(
          operation.id,
          tx
        );
        if (!latestVersion) {
          throw new NotFoundError("Operation has no published versions.");
        }

        const variablesSchema = parseVariablesSchemaJson(
          latestVersion.variablesSchemaJson
        );
        const prerequisites = parsePrerequisitesJson(
          latestVersion.prerequisitesJson
        );
        const steps = parseStepsSnapshotJson(latestVersion.stepsSnapshotJson);

        // STRICT SECURITY BOUNDARY: Never store secret variables in Turso!
        const safeValues = stripSecretVariables(
          input.variablesValues ?? {},
          variablesSchema
        );
        const checkedPrereqs = this.filterCheckedPrerequisites(
          input.prerequisitesChecked,
          prerequisites
        );

        const customTitle = input.title?.trim();
        const runTitle =
          customTitle && customTitle.length > 0
            ? customTitle.slice(0, 160)
            : `${operation.title} · Run`;

        const run = await this.operations.createRun(
          {
            operationId: operation.id,
            versionId: latestVersion.id,
            runnerId: userId,
            title: runTitle,
            variablesValuesJson: JSON.stringify(safeValues),
            prerequisitesCheckedJson: JSON.stringify(checkedPrereqs),
            nowMs,
          },
          tx
        );

        await this.operations.seedRunStepsBatch(
          run.id,
          steps.map((s) => s.key),
          nowMs,
          tx
        );

        return run;
      })
    );

    return this.assembleRunDetail(userId, createdRun);
  }

  async getRunDetail(
    userId: string,
    runId: string
  ): Promise<OperationRunDetailPayload> {
    const run = await this.operations.getRunByIdForRunner(runId, userId);
    if (!run) {
      throw new NotFoundError("Operation run not found.");
    }
    return this.assembleRunDetail(userId, run);
  }

  async updateRunPreflight(
    userId: string,
    runId: string,
    input: UpdateRunPreflightInput
  ): Promise<OperationRunRecord> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.operations.getRunByIdForRunner(
          runId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Operation run not found.");
        }
        if (existing.status !== "in_progress") {
          throw new ConflictError("Completed or abandoned runs cannot be modified.");
        }

        const pinnedVersion = await this.operations.getVersionById(
          existing.versionId,
          tx
        );
        if (!pinnedVersion) {
          throw new NotFoundError("Pinned operation version not found.");
        }

        const variablesSchema = parseVariablesSchemaJson(
          pinnedVersion.variablesSchemaJson
        );
        const prerequisites = parsePrerequisitesJson(
          pinnedVersion.prerequisitesJson
        );

        const patch: {
          title?: string;
          variablesValuesJson?: string;
          prerequisitesCheckedJson?: string;
          nowMs: number;
        } = { nowMs };

        if (input.title !== undefined) {
          const trimmed = input.title.trim();
          if (!trimmed || trimmed.length > 160) {
            throw new ValidationError(
              "Run title must be between 1 and 160 characters."
            );
          }
          patch.title = trimmed;
        }

        if (input.variablesValues !== undefined) {
          const safeValues = stripSecretVariables(
            input.variablesValues,
            variablesSchema
          );
          patch.variablesValuesJson = JSON.stringify(safeValues);
        }

        if (input.prerequisitesChecked !== undefined) {
          const safeChecked = this.filterCheckedPrerequisites(
            input.prerequisitesChecked,
            prerequisites
          );
          patch.prerequisitesCheckedJson = JSON.stringify(safeChecked);
        }

        const updated = await this.operations.updateRunPreflight(
          runId,
          userId,
          patch,
          tx
        );
        if (!updated) {
          throw new ConflictError("Run is no longer in progress.");
        }
        return updated;
      })
    );
  }

  async updateRunStep(
    userId: string,
    runId: string,
    input: UpdateRunStepInput
  ): Promise<OperationRunStepRecord> {
    if (
      input.note !== undefined &&
      input.note !== null &&
      input.note.length > MAX_RUN_STEP_NOTE_LENGTH
    ) {
      throw new ValidationError(
        `Step note must be at most ${MAX_RUN_STEP_NOTE_LENGTH} characters.`
      );
    }

    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.operations.getRunByIdForRunner(
          runId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Operation run not found.");
        }
        if (existing.status !== "in_progress") {
          throw new ConflictError("Completed or abandoned runs cannot be modified.");
        }

        const pinnedVersion = await this.operations.getVersionById(
          existing.versionId,
          tx
        );
        if (!pinnedVersion) {
          throw new NotFoundError("Pinned operation version not found.");
        }

        const steps = parseStepsSnapshotJson(pinnedVersion.stepsSnapshotJson);
        const validStep = steps.some((s) => s.key === input.stepKey);
        if (!validStep) {
          throw new ValidationError(
            `Step "${input.stepKey}" does not exist in this pinned version.`
          );
        }

        const updatedStep = await this.operations.upsertRunStep(
          {
            runId,
            stepKey: input.stepKey,
            status: input.status,
            note: input.note !== undefined ? input.note?.trim() || null : undefined,
            nowMs,
          },
          tx
        );

        await this.operations.updateRunPreflight(runId, userId, { nowMs }, tx);
        return updatedStep;
      })
    );
  }

  async syncOfflineRunMutations(
    userId: string,
    runId: string,
    input: SyncOfflineRunMutationsInput
  ): Promise<OperationRunDetailPayload> {
    const nowMs = this.now();

    const updatedRun = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.operations.getRunByIdForRunner(
          runId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Operation run not found.");
        }
        if (existing.status !== "in_progress") {
          throw new ConflictError("Completed or abandoned runs cannot sync offline edits.");
        }

        const pinnedVersion = await this.operations.getVersionById(
          existing.versionId,
          tx
        );
        if (!pinnedVersion) {
          throw new NotFoundError("Pinned operation version not found.");
        }

        const variablesSchema = parseVariablesSchemaJson(
          pinnedVersion.variablesSchemaJson
        );
        const prerequisites = parsePrerequisitesJson(
          pinnedVersion.prerequisitesJson
        );
        const validStepKeys = new Set(
          parseStepsSnapshotJson(pinnedVersion.stepsSnapshotJson).map(
            (s) => s.key
          )
        );

        for (const stepUpdate of input.stepUpdates ?? []) {
          if (!validStepKeys.has(stepUpdate.stepKey)) {
            continue;
          }
          const cleanNote =
            stepUpdate.note !== undefined
              ? stepUpdate.note?.trim().slice(0, MAX_RUN_STEP_NOTE_LENGTH) || null
              : undefined;
          await this.operations.upsertRunStep(
            {
              runId,
              stepKey: stepUpdate.stepKey,
              status: stepUpdate.status,
              note: cleanNote,
              nowMs,
            },
            tx
          );
        }

        const preflightPatch: {
          title?: string;
          variablesValuesJson?: string;
          prerequisitesCheckedJson?: string;
          nowMs: number;
        } = { nowMs };

        if (input.preflight?.title?.trim()) {
          preflightPatch.title = input.preflight.title.trim().slice(0, 160);
        }
        if (input.preflight?.variablesValues !== undefined) {
          preflightPatch.variablesValuesJson = JSON.stringify(
            stripSecretVariables(
              input.preflight.variablesValues,
              variablesSchema
            )
          );
        }
        if (input.preflight?.prerequisitesChecked !== undefined) {
          preflightPatch.prerequisitesCheckedJson = JSON.stringify(
            this.filterCheckedPrerequisites(
              input.preflight.prerequisitesChecked,
              prerequisites
            )
          );
        }

        const refreshed = await this.operations.updateRunPreflight(
          runId,
          userId,
          preflightPatch,
          tx
        );
        if (!refreshed) {
          throw new ConflictError("Run is no longer in progress.");
        }
        return refreshed;
      })
    );

    return this.assembleRunDetail(userId, updatedRun);
  }

  async completeRun(
    userId: string,
    runId: string,
    input: CompleteRunInput = {}
  ): Promise<CompleteRunResult> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.operations.getRunByIdForRunner(
          runId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Operation run not found.");
        }

        const completedRun = await this.operations.completeRunAtomically(
          runId,
          userId,
          nowMs,
          tx
        );
        if (!completedRun) {
          throw new ConflictError("This run is already completed or abandoned.");
        }

        const operation: OperationRecord | null = await this.operations.getById(
          completedRun.operationId,
          tx
        );

        let verifiedUpdated = false;
        if (
          input.markOperationVerified &&
          operation &&
          operation.ownerId === userId
        ) {
          const stamped = await this.operations.updateOperationSimple(
            operation.id,
            userId,
            { lastVerifiedAt: nowMs, updatedAt: nowMs },
            tx
          );
          verifiedUpdated = Boolean(stamped);
        }

        let habitAutoLogged: CompleteRunResult["habitAutoLogged"] = null;
        let habitAutoLogSkippedReason: string | null = null;

        if (
          input.autoLogLinkedHabit !== false &&
          operation?.linkedHabitId
        ) {
          const linkedHabit = await this.habits.getHabitForUser(
            userId,
            operation.linkedHabitId,
            tx
          );

          if (linkedHabit && !linkedHabit.isArchived) {
            const timezone =
              input.timezone ??
              (await this.users.getById(userId, tx))?.timezone ??
              "UTC";
            const todayDateKey = getLocalDateKey(nowMs, timezone);
            const yearMonth = todayDateKey.slice(0, 7);

            const [settings, lockRow] = await Promise.all([
              this.habits.getOrCreateSettings(userId, tx),
              this.habits.getMonthLock(userId, yearMonth, tx),
            ]);

            const lockState = evaluateMonthLockState({
              yearMonth,
              todayDateKey,
              nowMs,
              settings,
              lockRow,
            });

            if (lockState.isLocked) {
              habitAutoLogSkippedReason =
                "Current month is locked, so the linked habit was not auto-logged.";
            } else {
              await this.habits.upsertLog(
                {
                  habitId: linkedHabit.id,
                  userId,
                  dateKey: todayDateKey,
                  status: "done",
                  note: `Logged via Operation run: ${completedRun.title}`.slice(
                    0,
                    240
                  ),
                  loggedAt: nowMs,
                  isBackfilledLate: false,
                },
                tx
              );

              await this.habits.upsertMonthRosterEntries(
                [{ userId, habitId: linkedHabit.id, yearMonth }],
                tx
              );

              await this.tasks.syncLinkedTasksForHabitDay(
                {
                  userId,
                  habitId: linkedHabit.id,
                  dateKey: todayDateKey,
                  completed: true,
                  nowMs,
                },
                tx
              );

              habitAutoLogged = {
                habitId: linkedHabit.id,
                habitTitle: linkedHabit.title,
                dateKey: todayDateKey,
              };
            }
          }
        }

        return {
          run: completedRun,
          verifiedUpdated,
          habitAutoLogged,
          habitAutoLogSkippedReason,
        };
      })
    );
  }

  async abandonRun(userId: string, runId: string): Promise<OperationRunRecord> {
    const nowMs = this.now();
    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.operations.getRunByIdForRunner(
          runId,
          userId,
          tx
        );
        if (!existing) {
          throw new NotFoundError("Operation run not found.");
        }
        const abandoned = await this.operations.abandonRunAtomically(
          runId,
          userId,
          nowMs,
          tx
        );
        if (!abandoned) {
          throw new ConflictError("This run is already completed or abandoned.");
        }
        return abandoned;
      })
    );
  }

  async createBlockedStepTask(
    userId: string,
    runId: string,
    input: CreateBlockedStepTaskInput
  ): Promise<{ task: TaskRecord; reminder: ReminderRecord | null }> {
    const nowMs = this.now();

    const { task, reminder, shouldDispatch } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const run = await this.operations.getRunByIdForRunner(runId, userId, tx);
        if (!run) {
          throw new NotFoundError("Operation run not found.");
        }

        const [operation, pinnedVersion] = await Promise.all([
          this.operations.getById(run.operationId, tx),
          this.operations.getVersionById(run.versionId, tx),
        ]);
        if (!operation || !pinnedVersion) {
          throw new NotFoundError("Operation run version not found.");
        }

        const steps = parseStepsSnapshotJson(pinnedVersion.stepsSnapshotJson);
        const step = steps.find((s) => s.key === input.stepKey);
        if (!step) {
          throw new ValidationError(
            `Step "${input.stepKey}" does not exist in this run.`
          );
        }

        if (input.markStepBlocked !== false && run.status === "in_progress") {
          await this.operations.upsertRunStep(
            {
              runId,
              stepKey: step.key,
              status: "blocked",
              nowMs,
            },
            tx
          );
          await this.operations.updateRunPreflight(runId, userId, { nowMs }, tx);
        }

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

        const taskTitle =
          input.title?.trim() ||
          `Unblock "${step.title}" (${operation.title})`.slice(0, 200);
        const taskDescription =
          input.description?.trim() ||
          `Follow-up created from blocked step "${step.title}" during run "${run.title}".`;

        const createdTask = await this.tasks.create(
          {
            userId,
            projectId: targetProjectId,
            operationId: operation.id,
            operationRunId: run.id,
            title: taskTitle,
            description: taskDescription,
            priority: input.priority ?? "high",
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

    // Post-commit reminder dispatch ONLY!
    if (reminder && shouldDispatch) {
      await this.reminderService.dispatchScheduledReminder(reminder);
    }

    return { task, reminder };
  }
}

export const operationRunService = new OperationRunService();
