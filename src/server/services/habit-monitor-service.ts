import {
  ConflictError,
  EmailMismatchError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitSocialRepository,
  type HabitSocialRepository,
  type IncomingMonitorRequestItem,
  type KnownCollaborator,
  type MonitorWithUser,
} from "@/server/dal/habits-social";
import { db, withDbRetry, type AppDatabase, type DbExecutor } from "@/server/db";
import type {
  HabitCommentMode,
  HabitMonitorRecord,
  HabitMonitorRequestRecord,
  HabitMonitorScope,
  HabitRecord,
} from "@/server/db/schema";
import {
  sanitizeHabitTrackerSettings,
  type ClientHabitTrackerSettings,
} from "@/server/domain/habit-month-lock";
import {
  evaluateCommentWindow,
  formatPolicyBadge,
  resolveEffectivePolicy,
  type CommentWindowState,
  type EffectiveCommentPolicy,
} from "@/server/domain/comment-window-policy";
import {
  addDaysToDateKey,
  computeHabitMonthAnalytics,
  getLocalDateKey,
  isValidDateKey,
  isValidTimeHHmm,
  parseScheduledDaysJson,
} from "@/server/domain/habit-analytics";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "@/server/providers/redis/rate-limiter";
import {
  generateRawInviteToken,
  hashInviteToken,
  INVITE_EXPIRY_MS,
} from "@/server/services/project-invite-service";

export interface CustomPolicyInput {
  useCustomPolicy: boolean;
  customCommentMode?: HabitCommentMode | null;
  customWindowStartDay?: number | null;
  customWindowStartTime?: string | null;
  customWindowEndDay?: number | null;
  customWindowEndTime?: string | null;
  customIntervalDays?: number | null;
  customIntervalAnchorDate?: string | null;
  customIntervalOpenHours?: number | null;
  customAllowReactionsWhenLocked?: boolean | null;
}

export interface NormalizedCustomPolicy {
  useCustomPolicy: boolean;
  customCommentMode: HabitCommentMode | null;
  customWindowStartDay: number | null;
  customWindowStartTime: string | null;
  customWindowEndDay: number | null;
  customWindowEndTime: string | null;
  customIntervalDays: number | null;
  customIntervalAnchorDate: string | null;
  customIntervalOpenHours: number | null;
  customAllowReactionsWhenLocked: boolean | null;
}

export interface MonitoringFriendCard {
  ownerId: string;
  ownerName: string;
  ownerTimezone: string;
  monitorId: string;
  scope: HabitMonitorScope;
  sharedHabitCount: number;
  cycleCompletionPct: number | null;
  topActiveStreak: number;
  topStreakUnit: "days" | "weeks";
  effectivePolicy: EffectiveCommentPolicy;
  windowState: CommentWindowState;
}

export interface MyMonitorListItem {
  monitor: MonitorWithUser;
  effectivePolicy: EffectiveCommentPolicy;
  policyBadge: string;
  windowState: CommentWindowState;
}

export interface CircleOverviewData {
  incomingRequests: IncomingMonitorRequestItem[];
  outgoingRequests: HabitMonitorRequestRecord[];
  monitoringOthers: MonitoringFriendCard[];
  myMonitors: MyMonitorListItem[];
  knownCollaborators: KnownCollaborator[];
  myHabits: HabitRecord[];
  globalSettings: ClientHabitTrackerSettings;
  badgeCount: number;
}

export type HabitInviteTokenPreview =
  | {
      status: "valid";
      ownerName: string;
      scope: HabitMonitorScope;
      invitedEmailMasked: string;
      viewerEmailMatches: boolean;
      expiresAt: number;
    }
  | {
      status: "expired" | "revoked" | "accepted" | "declined" | "not_found";
      ownerName?: string;
    };

export interface HabitMonitorServiceDeps {
  database?: AppDatabase;
  social?: HabitSocialRepository;
  habits?: HabitRepository;
  rateLimiter?: RateLimiter;
  eventBus?: EventBus;
  now?: () => number;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export function normalizeCustomPolicyInput(
  input?: CustomPolicyInput | null
): NormalizedCustomPolicy {
  if (!input || !input.useCustomPolicy) {
    return {
      useCustomPolicy: false,
      customCommentMode: null,
      customWindowStartDay: null,
      customWindowStartTime: null,
      customWindowEndDay: null,
      customWindowEndTime: null,
      customIntervalDays: null,
      customIntervalAnchorDate: null,
      customIntervalOpenHours: null,
      customAllowReactionsWhenLocked: null,
    };
  }

  const mode = input.customCommentMode ?? "weekly_window";

  if (
    input.customWindowStartDay !== undefined &&
    input.customWindowStartDay !== null &&
    (!Number.isInteger(input.customWindowStartDay) ||
      input.customWindowStartDay < 0 ||
      input.customWindowStartDay > 6)
  ) {
    throw new ValidationError("Custom window start day must be 0–6.");
  }

  if (
    input.customWindowEndDay !== undefined &&
    input.customWindowEndDay !== null &&
    (!Number.isInteger(input.customWindowEndDay) ||
      input.customWindowEndDay < 0 ||
      input.customWindowEndDay > 6)
  ) {
    throw new ValidationError("Custom window end day must be 0–6.");
  }

  if (
    input.customWindowStartTime &&
    !isValidTimeHHmm(input.customWindowStartTime)
  ) {
    throw new ValidationError("Custom window start time must be HH:mm.");
  }

  if (
    input.customWindowEndTime &&
    !isValidTimeHHmm(input.customWindowEndTime)
  ) {
    throw new ValidationError("Custom window end time must be HH:mm.");
  }

  if (
    mode === "interval_days" &&
    (typeof input.customIntervalDays !== "number" ||
      !Number.isInteger(input.customIntervalDays) ||
      input.customIntervalDays < 2 ||
      input.customIntervalDays > 30)
  ) {
    throw new ValidationError("Custom interval days must be between 2 and 30.");
  }

  if (
    input.customIntervalDays !== undefined &&
    input.customIntervalDays !== null &&
    (!Number.isInteger(input.customIntervalDays) ||
      input.customIntervalDays < 2 ||
      input.customIntervalDays > 30)
  ) {
    throw new ValidationError("Custom interval days must be between 2 and 30.");
  }

  if (
    input.customIntervalAnchorDate &&
    !isValidDateKey(input.customIntervalAnchorDate)
  ) {
    throw new ValidationError(
      "Custom interval anchor date must be a valid YYYY-MM-DD date."
    );
  }

  if (
    input.customIntervalOpenHours !== undefined &&
    input.customIntervalOpenHours !== null &&
    (!Number.isInteger(input.customIntervalOpenHours) ||
      input.customIntervalOpenHours < 1 ||
      input.customIntervalOpenHours > 168)
  ) {
    throw new ValidationError(
      "Custom interval open hours must be between 1 and 168."
    );
  }

  return {
    useCustomPolicy: true,
    customCommentMode: mode,
    customWindowStartDay:
      mode === "weekly_window" ? (input.customWindowStartDay ?? 6) : null,
    customWindowStartTime:
      mode === "weekly_window" ? (input.customWindowStartTime ?? "00:00") : null,
    customWindowEndDay:
      mode === "weekly_window" ? (input.customWindowEndDay ?? 0) : null,
    customWindowEndTime:
      mode === "weekly_window" ? (input.customWindowEndTime ?? "23:59") : null,
    customIntervalDays:
      mode === "interval_days" ? (input.customIntervalDays ?? 4) : null,
    customIntervalAnchorDate:
      mode === "interval_days"
        ? (input.customIntervalAnchorDate || null)
        : null,
    customIntervalOpenHours:
      mode === "interval_days" ? (input.customIntervalOpenHours ?? 24) : null,
    customAllowReactionsWhenLocked:
      input.customAllowReactionsWhenLocked ?? true,
  };
}

function parseProposedPolicyJson(
  raw: string | null
): NormalizedCustomPolicy {
  if (!raw) return normalizeCustomPolicyInput(null);
  try {
    const parsed = JSON.parse(raw) as CustomPolicyInput;
    return normalizeCustomPolicyInput(parsed);
  } catch {
    return normalizeCustomPolicyInput(null);
  }
}

export class HabitMonitorService {
  private readonly database: AppDatabase;
  private readonly social: HabitSocialRepository;
  private readonly habits: HabitRepository;
  private readonly rateLimiter: RateLimiter;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: HabitMonitorServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.social = deps.social ?? habitSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.now = deps.now ?? (() => Date.now());
  }

  private async emitSafely(event: AppDomainEvent): Promise<void> {
    try {
      await this.eventBus.emit(event);
    } catch (error) {
      const isLocalDev =
        process.env.INNGEST_DEV === "1" ||
        process.env.NODE_ENV !== "production";
      if (isLocalDev) {
        console.warn(
          JSON.stringify({
            event: "habit.social.inngest_dev_unreachable",
            eventName: event.name,
            reason: error instanceof Error ? error.message : "Unknown error",
          })
        );
      } else {
        throw error;
      }
    }
  }

  private async enforceInviteRateLimit(ownerId: string): Promise<void> {
    const limitResult = await this.rateLimiter.limit(
      "habit_monitor_invite",
      ownerId
    );
    if (!limitResult.allowed) {
      throw new RateLimitError({
        message: `Monitor invite limit reached (20 per hour). Retry in ${limitResult.retryAfterSeconds}s.`,
        retryAfterSeconds: limitResult.retryAfterSeconds,
        limit: limitResult.limit,
        remaining: limitResult.remaining,
        resetAtMs: limitResult.resetAtMs,
      });
    }
  }

  private async validateSelectedHabits(
    ownerId: string,
    scope: HabitMonitorScope,
    selectedHabitIds: string[] | undefined,
    tx: DbExecutor
  ): Promise<string[]> {
    if (scope === "all") return [];
    const unique = Array.from(new Set((selectedHabitIds ?? []).filter(Boolean)));
    if (unique.length === 0) {
      throw new ValidationError(
        "Select at least one habit when sharing selected habits."
      );
    }
    const owned = await this.social.filterOwnedHabitIds(ownerId, unique, tx);
    if (owned.length !== unique.length) {
      throw new ForbiddenError(
        "One or more selected habits do not belong to your account."
      );
    }
    return owned;
  }

  async getCircleBadgeCount(userId: string): Promise<number> {
    const nowMs = this.now();
    const [incoming, monitoring] = await Promise.all([
      this.social.listIncomingPendingRequestsForUser(userId, nowMs),
      this.social.listMonitoringOwnersForUser(userId),
    ]);

    let openCount = 0;
    for (const item of monitoring) {
      const policy = resolveEffectivePolicy(item.globalSettings, item.monitor);
      const state = evaluateCommentWindow(policy, item.owner.timezone, nowMs);
      if (state.isOpen) openCount += 1;
    }

    return incoming.length + openCount;
  }

  async getCircleOverview(userId: string): Promise<CircleOverviewData> {
    const nowMs = this.now();
    const [
      incomingRequests,
      outgoingRequests,
      monitoringRaw,
      myMonitorsRaw,
      knownCollaborators,
      myHabits,
      globalSettings,
      ownerProfile,
    ] = await Promise.all([
      this.social.listIncomingPendingRequestsForUser(userId, nowMs),
      this.social.listOutgoingPendingRequestsForOwner(userId, nowMs),
      this.social.listMonitoringOwnersForUser(userId),
      this.social.listActiveMonitorsForOwner(userId),
      this.social.listKnownCollaborators(userId, nowMs),
      this.habits.listHabitsForUser(userId, { includeArchived: false }),
      this.habits.getOrCreateSettings(userId),
      this.social.findUserById(userId),
    ]);

    const ownerTimezone = ownerProfile?.timezone || "UTC";

    // Batched analytics hydration: 2 queries total instead of 2N N+1 loop across monitored friends
    const monitoredOwnerIds = Array.from(
      new Set(monitoringRaw.map((item) => item.owner.id))
    );
    const todayByOwner = new Map<
      string,
      { todayKey: string; yearMonth: string; lookback: string }
    >();
    let globalMinLookback = "9999-12-31";
    let globalMaxToday = "0000-01-01";
    for (const item of monitoringRaw) {
      const todayKey = getLocalDateKey(nowMs, item.owner.timezone);
      const yearMonth = todayKey.slice(0, 7);
      const lookback = addDaysToDateKey(`${yearMonth}-01`, -60);
      todayByOwner.set(item.owner.id, { todayKey, yearMonth, lookback });
      if (lookback < globalMinLookback) globalMinLookback = lookback;
      if (todayKey > globalMaxToday) globalMaxToday = todayKey;
    }

    const [allMonitoredHabits, allMonitoredLogs] =
      monitoredOwnerIds.length > 0
        ? await Promise.all([
            this.habits.listHabitsForUsers(monitoredOwnerIds, {
              includeArchived: false,
            }),
            this.habits.listLogsForUsersInRange(
              monitoredOwnerIds,
              globalMinLookback,
              globalMaxToday
            ),
          ])
        : [[], []];

    const habitsByOwner = new Map<string, HabitRecord[]>();
    for (const h of allMonitoredHabits) {
      const list = habitsByOwner.get(h.userId) ?? [];
      list.push(h);
      habitsByOwner.set(h.userId, list);
    }
    const logsByOwner = new Map<string, typeof allMonitoredLogs>();
    for (const log of allMonitoredLogs) {
      const list = logsByOwner.get(log.userId) ?? [];
      list.push(log);
      logsByOwner.set(log.userId, list);
    }

    const monitoringOthers: MonitoringFriendCard[] = monitoringRaw.map(
      (item) => {
        const effectivePolicy = resolveEffectivePolicy(
          item.globalSettings,
          item.monitor
        );
        const windowState = evaluateCommentWindow(
          effectivePolicy,
          item.owner.timezone,
          nowMs
        );

        const allOwnerHabits = habitsByOwner.get(item.owner.id) ?? [];
        const allowedSet =
          item.monitor.scope === "selected"
            ? new Set(item.selectedHabitIds)
            : null;
        const scopedHabits =
          allowedSet === null
            ? allOwnerHabits
            : allOwnerHabits.filter((h) => allowedSet.has(h.id));
        const scopedIds = new Set(scopedHabits.map((h) => h.id));

        const dates = todayByOwner.get(item.owner.id)!;
        const ownerLogs = logsByOwner.get(item.owner.id) ?? [];
        const scopedLogs =
          scopedHabits.length > 0
            ? ownerLogs.filter(
                (l) =>
                  scopedIds.has(l.habitId) &&
                  l.dateKey >= dates.lookback &&
                  l.dateKey <= dates.todayKey
              )
            : [];

        const analytics = computeHabitMonthAnalytics({
          yearMonth: dates.yearMonth,
          todayDateKey: dates.todayKey,
          weekStartsOn: item.globalSettings.weekStartsOn === 0 ? 0 : 1,
          scoringMode: "elapsed",
          habits: scopedHabits.map((h) => ({
            id: h.id,
            title: h.title,
            cadenceType: h.cadenceType,
            scheduledDays: parseScheduledDaysJson(h.scheduledDaysJson),
            weeklyTargetCount: h.weeklyTargetCount,
            startDate: h.startDate,
          })),
          logs: scopedLogs,
        });

        let topActiveStreak = 0;
        let topStreakUnit: "days" | "weeks" = "days";
        for (const summary of Object.values(analytics.byHabitId)) {
          if (summary.currentStreak > topActiveStreak) {
            topActiveStreak = summary.currentStreak;
            topStreakUnit = summary.streakUnit;
          }
        }

        return {
          ownerId: item.owner.id,
          ownerName: item.owner.name,
          ownerTimezone: item.owner.timezone,
          monitorId: item.monitor.id,
          scope: item.monitor.scope,
          sharedHabitCount: scopedHabits.length,
          cycleCompletionPct:
            analytics.monthlyProgress.rate !== null
              ? Math.round(analytics.monthlyProgress.rate * 100)
              : null,
          topActiveStreak,
          topStreakUnit,
          effectivePolicy,
          windowState,
        };
      }
    );

    const myMonitors: MyMonitorListItem[] = myMonitorsRaw.map((monitor) => {
      const effectivePolicy = resolveEffectivePolicy(globalSettings, monitor);
      const windowState = evaluateCommentWindow(
        effectivePolicy,
        ownerTimezone,
        nowMs
      );
      return {
        monitor,
        effectivePolicy,
        policyBadge: formatPolicyBadge(effectivePolicy),
        windowState,
      };
    });

    const openReviewCount = monitoringOthers.filter(
      (f) => f.windowState.isOpen
    ).length;

    // Sanitize outgoing/incoming request payloads: never expose tokenHash or targetUserId
    // and mask user-targeted emails so collaborator IDs cannot be abused for email harvesting.
    const safeIncomingRequests = incomingRequests.map((req) => ({
      ...req,
      tokenHash: null,
    }));
    const safeOutgoingRequests = outgoingRequests.map((req) => ({
      ...req,
      tokenHash: null,
      targetUserId: null,
      targetEmail: req.targetUserId ? maskEmail(req.targetEmail) : req.targetEmail,
    }));

    return {
      incomingRequests: safeIncomingRequests,
      outgoingRequests: safeOutgoingRequests,
      monitoringOthers,
      myMonitors,
      knownCollaborators,
      myHabits,
      globalSettings: sanitizeHabitTrackerSettings(globalSettings),
      badgeCount: incomingRequests.length + openReviewCount,
    };
  }

  /**
   * Path A — Quick-pick existing project collaborator:
   * creates an immediate in-app monitor request (`targetUserId` populated, `tokenHash = null`).
   */
  async inviteCollaborator(
    ownerId: string,
    input: {
      targetUserId: string;
      scope: HabitMonitorScope;
      selectedHabitIds?: string[];
      customPolicy?: CustomPolicyInput | null;
    }
  ): Promise<{ request: HabitMonitorRequestRecord; message: string }> {
    await this.enforceInviteRateLimit(ownerId);

    if (input.targetUserId === ownerId) {
      throw new ValidationError("You cannot invite yourself as a monitor.");
    }

    const normalizedPolicy = normalizeCustomPolicyInput(input.customPolicy);
    const nowMs = this.now();
    const expiresAt = nowMs + INVITE_EXPIRY_MS;

    const { request, ownerName, targetUser } = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const isCollaborator = await this.social.isProjectCollaborator(
          ownerId,
          input.targetUserId,
          tx
        );
        if (!isCollaborator) {
          throw new ForbiddenError(
            "Quick-invite is only available for teammates who share an active project with you."
          );
        }

        const owner = await this.social.findUserById(ownerId, tx);
        const target = await this.social.findUserById(input.targetUserId, tx);
        if (!owner) throw new NotFoundError("Owner account not found.");
        if (!target || target.isSuspended || !target.emailVerified) {
          throw new NotFoundError("Collaborator not found.");
        }

        const normalizedEmail = target.email.trim().toLowerCase();

        const existingMonitor = await this.social.getActiveMonitor(
          ownerId,
          target.id,
          tx
        );
        if (existingMonitor) {
          throw new ConflictError(
            "This collaborator is already an active monitor."
          );
        }

        const existingPending =
          await this.social.findPendingRequestByOwnerAndEmail(
            ownerId,
            normalizedEmail,
            tx
          );
        if (existingPending) {
          if (existingPending.expiresAt > nowMs) {
            throw new ConflictError(
              "A monitor request is already pending for this person."
            );
          }
          await this.social.updateRequestStatus(
            existingPending.id,
            "expired",
            null,
            tx
          );
        }

        const validatedHabitIds = await this.validateSelectedHabits(
          ownerId,
          input.scope,
          input.selectedHabitIds,
          tx
        );

        const created = await this.social.createMonitorRequest(
          {
            ownerId,
            targetUserId: target.id,
            targetEmail: normalizedEmail,
            tokenHash: null,
            scope: input.scope,
            selectedHabitIdsJson: JSON.stringify(validatedHabitIds),
            proposedPolicyJson: normalizedPolicy.useCustomPolicy
              ? JSON.stringify(normalizedPolicy)
              : null,
            expiresAt,
            nowMs,
          },
          tx
        );

        return { request: created, ownerName: owner.name, targetUser: target };
      })
    );

    await this.emitSafely({
      id: `habit-monitor-req-${request.id}`,
      name: "app/habit.monitor_requested",
      data: {
        requestId: request.id,
        ownerId,
        ownerName,
        targetUserId: targetUser.id,
        scope: request.scope,
      },
    });

    return {
      request: {
        ...request,
        tokenHash: null,
        targetUserId: null,
        targetEmail: maskEmail(request.targetEmail),
      },
      message: `Monitor request sent to ${targetUser.name}.`,
    };
  }

  /**
   * Path B — Invite by Email with strict Zero Email Enumeration:
   * - Existing Folio account -> in-app `targetUserId` request (`tokenHash = null`)
   * - External email -> 32-byte CSPRNG SHA-256 `tokenHash` invite email (`/invite/habit/[rawToken]`)
   * ALWAYS returns the exact same neutral message (`Monitor invitation sent to <email>`).
   */
  async inviteByEmail(
    ownerId: string,
    input: {
      email: string;
      scope: HabitMonitorScope;
      selectedHabitIds?: string[];
      customPolicy?: CustomPolicyInput | null;
    }
  ): Promise<{
    requestId: string;
    message: string;
    invitePathForInternalEmailOnly?: string;
  }> {
    await this.enforceInviteRateLimit(ownerId);

    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw new ValidationError("Please enter a valid email address.");
    }

    const normalizedPolicy = normalizeCustomPolicyInput(input.customPolicy);
    const nowMs = this.now();
    const expiresAt = nowMs + INVITE_EXPIRY_MS;
    const rawToken = generateRawInviteToken();
    const candidateHash = hashInviteToken(rawToken);

    const committed = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const owner = await this.social.findUserById(ownerId, tx);
        if (!owner) throw new NotFoundError("Owner account not found.");

        if (owner.email.trim().toLowerCase() === normalizedEmail) {
          throw new ValidationError("You cannot invite yourself as a monitor.");
        }

        const foundUser = await this.social.findUserByNormalizedEmail(
          normalizedEmail,
          tx
        );
        // Only link in-app to verified, non-suspended accounts
        const existingUser =
          foundUser && foundUser.emailVerified && !foundUser.isSuspended
            ? foundUser
            : null;

        if (existingUser) {
          const existingMonitor = await this.social.getActiveMonitor(
            ownerId,
            existingUser.id,
            tx
          );
          if (existingMonitor) {
            throw new ConflictError(
              "An active monitor or pending invitation already exists for this email."
            );
          }
        }

        const existingPending =
          await this.social.findPendingRequestByOwnerAndEmail(
            ownerId,
            normalizedEmail,
            tx
          );
        if (existingPending) {
          if (existingPending.expiresAt > nowMs) {
            throw new ConflictError(
              "An active monitor or pending invitation already exists for this email."
            );
          }
          await this.social.updateRequestStatus(
            existingPending.id,
            "expired",
            null,
            tx
          );
        }

        const validatedHabitIds = await this.validateSelectedHabits(
          ownerId,
          input.scope,
          input.selectedHabitIds,
          tx
        );

        const created = await this.social.createMonitorRequest(
          {
            ownerId,
            targetUserId: existingUser ? existingUser.id : null,
            targetEmail: normalizedEmail,
            tokenHash: existingUser ? null : candidateHash,
            scope: input.scope,
            selectedHabitIdsJson: JSON.stringify(validatedHabitIds),
            proposedPolicyJson: normalizedPolicy.useCustomPolicy
              ? JSON.stringify(normalizedPolicy)
              : null,
            expiresAt,
            nowMs,
          },
          tx
        );

        return {
          request: created,
          ownerName: owner.name,
          existingUserId: existingUser?.id ?? null,
        };
      })
    );

    const baseUrl =
      process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";

    if (committed.existingUserId) {
      await this.emitSafely({
        id: `habit-monitor-req-${committed.request.id}`,
        name: "app/habit.monitor_requested",
        data: {
          requestId: committed.request.id,
          ownerId,
          ownerName: committed.ownerName,
          targetUserId: committed.existingUserId,
          scope: committed.request.scope,
        },
      });
    } else {
      const invitePath = `/invite/habit/${rawToken}`;
      await this.emitSafely({
        id: `habit-monitor-inv-${committed.request.id}`,
        name: "app/habit.monitor_invited",
        data: {
          requestId: committed.request.id,
          ownerId,
          ownerName: committed.ownerName,
          targetEmail: normalizedEmail,
          scope: committed.request.scope,
          inviteUrl: `${baseUrl}${invitePath}`,
        },
      });
    }

    // Uniform anti-enumeration response regardless of whether an account existed
    return {
      requestId: committed.request.id,
      message: `Monitor invitation sent to ${normalizedEmail}`,
    };
  }

  async previewTokenInvite(
    rawToken: string,
    viewerEmail?: string | null
  ): Promise<HabitInviteTokenPreview> {
    const trimmed = rawToken.trim();
    if (!trimmed) return { status: "not_found" };

    const tokenHash = hashInviteToken(trimmed);
    const match = await this.social.findRequestByTokenHash(tokenHash);
    if (!match) return { status: "not_found" };

    const { request, ownerName } = match;
    if (request.status !== "pending") {
      return { status: request.status, ownerName };
    }
    if (request.expiresAt <= this.now()) {
      return { status: "expired", ownerName };
    }

    const invitedEmailNormalized = request.targetEmail.trim().toLowerCase();
    const viewerNormalized = viewerEmail?.trim().toLowerCase() ?? null;

    return {
      status: "valid",
      ownerName,
      scope: request.scope,
      invitedEmailMasked: maskEmail(request.targetEmail),
      viewerEmailMatches:
        viewerNormalized !== null && viewerNormalized === invitedEmailNormalized,
      expiresAt: request.expiresAt,
    };
  }

  private async activateMonitorFromClaimedRequest(
    claimed: HabitMonitorRequestRecord,
    acceptorUserId: string,
    nowMs: number,
    tx: DbExecutor
  ): Promise<HabitMonitorRecord> {
    if (claimed.ownerId === acceptorUserId) {
      throw new ValidationError("You cannot monitor your own habits.");
    }

    const proposed = parseProposedPolicyJson(claimed.proposedPolicyJson);
    const monitor = await this.social.upsertActiveMonitor(
      {
        ownerId: claimed.ownerId,
        monitorUserId: acceptorUserId,
        scope: claimed.scope,
        ...proposed,
        nowMs,
      },
      tx
    );

    if (claimed.scope === "selected") {
      const requestedHabitIds = parseJsonStringArray(
        claimed.selectedHabitIdsJson
      );
      // Re-verify ownership at accept time so stale/deleted IDs never fail or leak
      const verifiedHabitIds = await this.social.filterOwnedHabitIds(
        claimed.ownerId,
        requestedHabitIds,
        tx
      );
      await this.social.replaceMonitorItems(monitor.id, verifiedHabitIds, tx);
    } else {
      await this.social.replaceMonitorItems(monitor.id, [], tx);
    }

    return monitor;
  }

  /**
   * Atomically accepts an in-app monitor request via conditional SQLite UPDATE.
   */
  async acceptInAppRequest(
    requestId: string,
    authenticatedUser: { id: string; email: string; emailVerified: boolean }
  ): Promise<{ monitor: HabitMonitorRecord; ownerId: string }> {
    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenError(
        "Please verify your email address before accepting a monitor request."
      );
    }

    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const req = await this.social.findRequestById(requestId, tx);
        if (!req) {
          throw new NotFoundError("Monitor request not found.");
        }

        // Strictly require `targetUserId === authenticatedUser.id` so external
        // token-gated invites (`targetUserId === null`) cannot be claimed without the token.
        if (req.targetUserId !== authenticatedUser.id) {
          throw new ForbiddenError("This monitor request belongs to another user.");
        }

        if (req.status === "pending" && req.expiresAt <= nowMs) {
          await this.social.updateRequestStatus(req.id, "expired", null, tx);
          throw new ValidationError("This monitor request has expired.");
        }

        const claimed = await this.social.claimPendingRequestAtomically(
          req.id,
          nowMs,
          tx
        );
        if (!claimed) {
          throw new ConflictError(
            "This monitor request has already been processed or expired."
          );
        }

        const monitor = await this.activateMonitorFromClaimedRequest(
          claimed,
          authenticatedUser.id,
          nowMs,
          tx
        );
        return { monitor, ownerId: claimed.ownerId };
      })
    );
  }

  /**
   * Atomically accepts an external SHA-256 token invite after verified email match.
   */
  async acceptTokenInvite(
    rawToken: string,
    authenticatedUser: { id: string; email: string; emailVerified: boolean }
  ): Promise<{ monitor: HabitMonitorRecord; ownerId: string }> {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      throw new NotFoundError("Invitation link is invalid.");
    }

    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenError(
        "Please verify your email address before accepting a monitor invitation."
      );
    }

    const tokenHash = hashInviteToken(trimmed);
    const nowMs = this.now();
    const userEmail = authenticatedUser.email.trim().toLowerCase();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const match = await this.social.findRequestByTokenHash(tokenHash, tx);
        if (!match) {
          throw new NotFoundError("This monitor invitation link is invalid.");
        }

        const { request } = match;
        const targetEmail = request.targetEmail.trim().toLowerCase();
        if (userEmail !== targetEmail) {
          throw new EmailMismatchError(
            `This invitation was sent to ${maskEmail(targetEmail)}. You are signed in as ${authenticatedUser.email}.`
          );
        }

        if (request.status === "revoked" || request.status === "declined") {
          throw new ForbiddenError("This monitor invitation is no longer active.");
        }

        if (request.status === "pending" && request.expiresAt <= nowMs) {
          await this.social.updateRequestStatus(request.id, "expired", null, tx);
          throw new ValidationError("This monitor invitation has expired.");
        }

        const claimed = await this.social.claimPendingRequestAtomically(
          request.id,
          nowMs,
          tx
        );
        if (!claimed) {
          throw new ConflictError(
            "This monitor invitation has already been accepted or expired."
          );
        }

        const monitor = await this.activateMonitorFromClaimedRequest(
          claimed,
          authenticatedUser.id,
          nowMs,
          tx
        );
        return { monitor, ownerId: claimed.ownerId };
      })
    );
  }

  async declineInAppRequest(
    requestId: string,
    userId: string
  ): Promise<void> {
    const nowMs = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const req = await this.social.findRequestById(requestId, tx);
        if (!req || req.targetUserId !== userId) {
          throw new NotFoundError("Monitor request not found.");
        }
        if (req.status !== "pending") {
          throw new ConflictError("This monitor request is no longer pending.");
        }
        await this.social.updateRequestStatus(req.id, "declined", nowMs, tx);
      })
    );
  }

  async revokePendingRequest(
    ownerId: string,
    requestId: string
  ): Promise<void> {
    const nowMs = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const req = await this.social.findRequestById(requestId, tx);
        if (!req || req.ownerId !== ownerId) {
          throw new NotFoundError("Monitor invitation not found.");
        }
        if (req.status !== "pending") {
          throw new ConflictError("Only pending invitations can be revoked.");
        }
        await this.social.updateRequestStatus(req.id, "revoked", nowMs, tx);
      })
    );
  }

  async updateMonitorConfiguration(
    ownerId: string,
    monitorId: string,
    input: {
      scope?: HabitMonitorScope;
      selectedHabitIds?: string[];
      customPolicy?: CustomPolicyInput | null;
    }
  ): Promise<HabitMonitorRecord> {
    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.social.getMonitorByIdForOwner(
          ownerId,
          monitorId,
          tx
        );
        if (!existing || existing.status !== "active") {
          throw new NotFoundError("Active monitor not found.");
        }

        const nextScope = input.scope ?? existing.scope;
        const validatedHabitIds =
          input.scope !== undefined || input.selectedHabitIds !== undefined
            ? await this.validateSelectedHabits(
                ownerId,
                nextScope,
                input.selectedHabitIds,
                tx
              )
            : null;

        const normalizedPolicy =
          input.customPolicy !== undefined
            ? normalizeCustomPolicyInput(input.customPolicy)
            : null;

        const updated = await this.social.updateMonitorConfigForOwner(
          ownerId,
          monitorId,
          {
            ...(input.scope !== undefined ? { scope: input.scope } : {}),
            ...(normalizedPolicy ?? {}),
          },
          nowMs,
          tx
        );

        if (!updated) {
          throw new NotFoundError("Active monitor not found.");
        }

        if (validatedHabitIds !== null) {
          await this.social.replaceMonitorItems(
            updated.id,
            nextScope === "selected" ? validatedHabitIds : [],
            tx
          );
        }

        return updated;
      })
    );
  }

  async revokeMonitor(ownerId: string, monitorId: string): Promise<void> {
    const nowMs = this.now();
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const revoked = await this.social.revokeMonitorForOwner(
          ownerId,
          monitorId,
          nowMs,
          tx
        );
        if (!revoked) {
          throw new NotFoundError("Active monitor not found.");
        }
      })
    );
  }
}

export const habitMonitorService = new HabitMonitorService();
