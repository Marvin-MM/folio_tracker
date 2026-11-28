import {
  CommentWindowClosedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  habitRepository,
  type HabitRepository,
} from "@/server/dal/habits";
import {
  habitSocialRepository,
  type HabitCommentWithAuthor,
  type HabitReactionWithAuthor,
  type HabitSocialRepository,
} from "@/server/dal/habits-social";
import { db, withDbRetry, type AppDatabase } from "@/server/db";
import type {
  HabitCommentRecord,
  HabitReactionRecord,
  HabitReactionType,
} from "@/server/db/schema";
import {
  evaluateCommentWindow,
  resolveEffectivePolicy,
} from "@/server/domain/comment-window-policy";
import { isValidDateKey } from "@/server/domain/habit-analytics";
import {
  defaultEventBus,
  type EventBus,
} from "@/server/providers/event-bus";

const MAX_COMMENT_LENGTH = 1000;

export interface CreateHabitCommentInput {
  ownerId: string;
  cycleKey?: string;
  targetDateKey?: string | null;
  targetHabitId?: string | null;
  parentCommentId?: string | null;
  body: string;
}

export interface ToggleHabitReactionInput {
  ownerId: string;
  cycleKey: string;
  targetDateKey?: string | null;
  reactionType: HabitReactionType;
}

export interface OwnerReviewsData {
  activeCycleKey: string;
  availableCycleKeys: string[];
  comments: HabitCommentWithAuthor[];
  reactions: HabitReactionWithAuthor[];
}

export interface HabitCommentServiceDeps {
  database?: AppDatabase;
  social?: HabitSocialRepository;
  habits?: HabitRepository;
  eventBus?: EventBus;
  now?: () => number;
}

export class HabitCommentService {
  private readonly database: AppDatabase;
  private readonly social: HabitSocialRepository;
  private readonly habits: HabitRepository;
  private readonly eventBus: EventBus;
  private readonly now: () => number;

  constructor(deps: HabitCommentServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.social = deps.social ?? habitSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Creates a cycle-anchored habit comment or threaded reply.
   *
   * SECURITY & POLICY INVARIANTS:
   * - Direct Turso check on `habit_monitors` (zero Redis cache).
   * - Server-side `evaluateCommentWindow()` enforced on EVERY monitor write -> throws `CommentWindowClosedError` (403).
   * - Selective-scope monitor cannot attach comments or replies to unshared `targetHabitId`.
   * - Habit owner can ALWAYS post reflections or reply to existing threads regardless of lock status.
   */
  async createComment(
    actorId: string,
    input: CreateHabitCommentInput
  ): Promise<HabitCommentRecord> {
    const body = input.body.trim();
    if (!body) {
      throw new ValidationError("Comment cannot be empty.");
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      throw new ValidationError(
        `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`
      );
    }

    const targetDateKey = input.targetDateKey?.trim() || null;
    if (targetDateKey && !isValidDateKey(targetDateKey)) {
      throw new ValidationError("Target date must be a valid YYYY-MM-DD date.");
    }

    const nowMs = this.now();

    const committed = await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const owner = await this.social.findUserById(input.ownerId, tx);
        const actor = await this.social.findUserById(actorId, tx);
        const globalSettings = await this.habits.getOrCreateSettings(
          input.ownerId,
          tx
        );

        if (!owner) {
          throw new NotFoundError("Habit tracker owner not found.");
        }
        if (!actor) {
          throw new NotFoundError("Author account not found.");
        }

        const ownerTimezone = owner.timezone || "UTC";
        const isOwner = actorId === input.ownerId;
        let allowedHabitSet: Set<string> | null = null;
        let resolvedCycleKey: string;

        let parentComment: HabitCommentRecord | null = null;
        if (input.parentCommentId) {
          parentComment = await this.social.getCommentById(
            input.parentCommentId,
            tx
          );
          if (!parentComment || parentComment.ownerId !== input.ownerId) {
            throw new NotFoundError("Parent comment not found.");
          }
        }

        if (!isOwner) {
          const monitor = await this.social.getActiveMonitor(
            input.ownerId,
            actorId,
            tx
          );
          if (!monitor) {
            throw new ForbiddenError(
              "You must be an active monitor to comment on this habit tracker."
            );
          }

          const effectivePolicy = resolveEffectivePolicy(
            globalSettings,
            monitor
          );
          const windowState = evaluateCommentWindow(
            effectivePolicy,
            ownerTimezone,
            nowMs
          );

          if (!windowState.isOpen) {
            throw new CommentWindowClosedError({
              opensAtUtcMs: windowState.opensAtUtcMs,
              summary: windowState.summary,
            });
          }

          if (monitor.scope === "selected") {
            const allowedIds = await this.social.listAllowedHabitIdsForMonitor(
              monitor.id,
              tx
            );
            allowedHabitSet = new Set(allowedIds);
          }

          // Block replying to a parent comment anchored to an unshared habit
          if (
            parentComment?.targetHabitId &&
            allowedHabitSet !== null &&
            !allowedHabitSet.has(parentComment.targetHabitId)
          ) {
            throw new ForbiddenError(
              "You do not have access to this comment thread."
            );
          }

          resolvedCycleKey = parentComment?.cycleKey ?? windowState.cycleKey;
        } else {
          // Owner can always post reflections or reply regardless of lock state
          const ownerGlobalPolicy = resolveEffectivePolicy(globalSettings, null);
          const ownerWindow = evaluateCommentWindow(
            ownerGlobalPolicy,
            ownerTimezone,
            nowMs
          );
          resolvedCycleKey =
            parentComment?.cycleKey ??
            input.cycleKey?.trim() ??
            ownerWindow.cycleKey;
        }

        const targetHabitId =
          input.targetHabitId?.trim() || parentComment?.targetHabitId || null;

        if (targetHabitId) {
          const habit = await this.habits.getHabitForUser(
            input.ownerId,
            targetHabitId,
            tx
          );
          if (!habit) {
            throw new NotFoundError("Referenced habit not found.");
          }
          if (allowedHabitSet !== null && !allowedHabitSet.has(habit.id)) {
            throw new ForbiddenError(
              "You do not have monitor access to the referenced habit."
            );
          }
        }

        const created = await this.social.createComment(
          {
            ownerId: input.ownerId,
            authorId: actorId,
            cycleKey: resolvedCycleKey,
            targetDateKey: targetDateKey ?? parentComment?.targetDateKey ?? null,
            targetHabitId,
            parentCommentId: parentComment?.id ?? null,
            body,
            nowMs,
          },
          tx
        );

        // Determine notification recipient: monitor -> owner; owner reply -> active monitor only
        let recipientUserId: string | null = null;
        if (!isOwner) {
          recipientUserId = input.ownerId;
        } else if (parentComment && parentComment.authorId !== input.ownerId) {
          const activeParentMonitor = await this.social.getActiveMonitor(
            input.ownerId,
            parentComment.authorId,
            tx
          );
          if (activeParentMonitor) {
            recipientUserId = parentComment.authorId;
          }
        }

        return {
          comment: created,
          authorName: actor.name,
          recipientUserId,
          isOwner,
        };
      })
    );

    if (committed.recipientUserId) {
      const deepLink = committed.isOwner
        ? `/app/habits/circle/${input.ownerId}`
        : "/app/habits/circle";
      try {
        await this.eventBus.emit({
          id: `habit-comment-${committed.comment.id}`,
          name: "app/habit.comment_posted",
          data: {
            commentId: committed.comment.id,
            ownerId: input.ownerId,
            authorId: actorId,
            authorName: committed.authorName,
            recipientUserId: committed.recipientUserId,
            cycleKey: committed.comment.cycleKey,
            bodyPreview: body.slice(0, 140),
            deepLink,
          },
        });
      } catch (error) {
        const isLocalDev =
          process.env.INNGEST_DEV === "1" ||
          process.env.NODE_ENV !== "production";
        if (isLocalDev) {
          console.warn(
            JSON.stringify({
              event: "habit.comment.inngest_dev_unreachable",
              commentId: committed.comment.id,
              reason: error instanceof Error ? error.message : "Unknown error",
            })
          );
        }
      }
    }

    return committed.comment;
  }

  async deleteComment(actorId: string, commentId: string): Promise<void> {
    await withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const existing = await this.social.getCommentById(commentId, tx);
        if (!existing) {
          throw new NotFoundError("Comment not found.");
        }
        if (existing.authorId !== actorId && existing.ownerId !== actorId) {
          throw new ForbiddenError(
            "Only the comment author or habit owner can delete this comment."
          );
        }
        await this.social.deleteComment(commentId, tx);
      })
    );
  }

  async listOwnerReviews(
    ownerId: string,
    selectedCycleKey?: string
  ): Promise<OwnerReviewsData> {
    const nowMs = this.now();
    const [owner, globalSettings, recentCycles] = await Promise.all([
      this.social.findUserById(ownerId),
      this.habits.getOrCreateSettings(ownerId),
      this.social.listRecentCycleKeysForOwner(ownerId, null),
    ]);

    const tz = owner?.timezone || "UTC";
    const windowState = evaluateCommentWindow(
      resolveEffectivePolicy(globalSettings, null),
      tz,
      nowMs
    );

    const availableCycleKeys = Array.from(
      new Set([
        windowState.cycleKey,
        ...(windowState.lastClosedCycleKey
          ? [windowState.lastClosedCycleKey]
          : []),
        ...recentCycles,
      ])
    );

    const activeCycleKey =
      selectedCycleKey && availableCycleKeys.includes(selectedCycleKey)
        ? selectedCycleKey
        : recentCycles[0] ?? windowState.cycleKey;

    const [comments, reactions] = await Promise.all([
      this.social.listCommentsForOwnerCycle(ownerId, activeCycleKey, null),
      this.social.listReactionsForOwnerCycle(ownerId, activeCycleKey),
    ]);

    return {
      activeCycleKey,
      availableCycleKeys,
      comments,
      reactions,
    };
  }
}

export class HabitReactionService {
  private readonly database: AppDatabase;
  private readonly social: HabitSocialRepository;
  private readonly habits: HabitRepository;
  private readonly now: () => number;

  constructor(
    deps: {
      database?: AppDatabase;
      social?: HabitSocialRepository;
      habits?: HabitRepository;
      now?: () => number;
    } = {}
  ) {
    this.database = deps.database ?? db;
    this.social = deps.social ?? habitSocialRepository;
    this.habits = deps.habits ?? habitRepository;
    this.now = deps.now ?? (() => Date.now());
  }

  async toggleReaction(
    actorId: string,
    input: ToggleHabitReactionInput
  ): Promise<{ active: boolean; reaction: HabitReactionRecord | null }> {
    const cycleKey = input.cycleKey.trim();
    if (!cycleKey) {
      throw new ValidationError("Cycle key is required.");
    }
    const targetDateKey = input.targetDateKey?.trim() || null;
    if (targetDateKey && !isValidDateKey(targetDateKey)) {
      throw new ValidationError("Target date must be a valid YYYY-MM-DD date.");
    }

    const nowMs = this.now();

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const owner = await this.social.findUserById(input.ownerId, tx);
        const globalSettings = await this.habits.getOrCreateSettings(
          input.ownerId,
          tx
        );
        if (!owner) {
          throw new NotFoundError("Habit owner not found.");
        }

        if (actorId !== input.ownerId) {
          const monitor = await this.social.getActiveMonitor(
            input.ownerId,
            actorId,
            tx
          );
          if (!monitor) {
            throw new ForbiddenError(
              "You must be an active monitor to react to this habit tracker."
            );
          }

          const effectivePolicy = resolveEffectivePolicy(
            globalSettings,
            monitor
          );
          const windowState = evaluateCommentWindow(
            effectivePolicy,
            owner.timezone || "UTC",
            nowMs
          );

          if (!windowState.canReact) {
            throw new CommentWindowClosedError({
              message: `Reactions are locked until the review window opens (${windowState.summary}).`,
              opensAtUtcMs: windowState.opensAtUtcMs,
              summary: windowState.summary,
            });
          }
        }

        return this.social.toggleReaction(
          {
            ownerId: input.ownerId,
            authorId: actorId,
            cycleKey,
            targetDateKey,
            reactionType: input.reactionType,
            nowMs,
          },
          tx
        );
      })
    );
  }
}

export const habitCommentService = new HabitCommentService();
export const habitReactionService = new HabitReactionService();
