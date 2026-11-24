"use client";

import { useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  Check,
  CornerDownRight,
  Flame,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createHabitCommentAction,
  deleteHabitCommentAction,
  toggleHabitReactionAction,
} from "@/actions/habits-social";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  HabitCommentWithAuthor,
  HabitReactionWithAuthor,
} from "@/server/dal/habits-social";
import type { HabitReactionType, HabitRecord } from "@/server/db/schema";
import {
  formatCycleDisplayLabel,
  type CommentWindowState,
} from "@/server/domain/comment-window-policy";

interface HabitReviewPanelProps {
  ownerId: string;
  ownerName: string;
  ownerTimezone: string;
  currentUserId: string;
  isOwner: boolean;
  windowState: CommentWindowState | null;
  activeCycleKey: string;
  availableCycleKeys: string[];
  onSelectCycle?: (cycleKey: string) => void;
  scopedHabits: HabitRecord[];
  comments: HabitCommentWithAuthor[];
  reactions: HabitReactionWithAuthor[];
}

const REACTION_META: Array<{
  type: HabitReactionType;
  label: string;
  icon: typeof Check;
}> = [
  { type: "ack", label: "Seen", icon: Check },
  { type: "solid", label: "Solid", icon: Sparkles },
  { type: "push", label: "Keep going", icon: Flame },
];

function formatCommentTime(ms: number, timezone: string): string {
  try {
    return formatInTimeZone(ms, timezone, "MMM d · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d · HH:mm");
  }
}

export function HabitReviewPanel({
  ownerId,
  ownerName,
  ownerTimezone,
  currentUserId,
  isOwner,
  windowState,
  activeCycleKey,
  availableCycleKeys,
  onSelectCycle,
  scopedHabits,
  comments,
  reactions,
}: HabitReviewPanelProps) {
  const [body, setBody] = useState("");
  const [targetHabitId, setTargetHabitId] = useState("none");
  const [targetDateKey, setTargetDateKey] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();

  const canComment = isOwner || Boolean(windowState?.isOpen);
  const canReact = isOwner || Boolean(windowState?.canReact);

  // Organize comments into root + replies map
  const rootComments = comments.filter((c) => c.parentCommentId === null);
  const repliesByParent = new Map<string, HabitCommentWithAuthor[]>();
  for (const c of comments) {
    if (!c.parentCommentId) continue;
    const list = repliesByParent.get(c.parentCommentId) ?? [];
    list.push(c);
    repliesByParent.set(c.parentCommentId, list);
  }

  const handlePostComment = () => {
    if (!body.trim() || isPending) return;
    startTransition(async () => {
      const result = await createHabitCommentAction({
        ownerId,
        cycleKey: activeCycleKey,
        targetHabitId: targetHabitId === "none" ? null : targetHabitId,
        targetDateKey: targetDateKey.trim() || null,
        body: body.trim(),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setBody("");
      setTargetHabitId("none");
      setTargetDateKey("");
      await invalidate(["circle"], { ownerId });
      toast.success("Review note posted.");
    });
  };

  const handlePostReply = (parentId: string) => {
    if (!replyBody.trim() || isPending) return;
    startTransition(async () => {
      const result = await createHabitCommentAction({
        ownerId,
        cycleKey: activeCycleKey,
        parentCommentId: parentId,
        body: replyBody.trim(),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setReplyBody("");
      setReplyingToId(null);
      await invalidate(["circle"], { ownerId });
      toast.success("Reply posted.");
    });
  };

  const handleDeleteComment = (commentId: string) => {
    startTransition(async () => {
      const result = await deleteHabitCommentAction({ commentId, ownerId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["circle"], { ownerId });
      toast.success("Comment removed.");
    });
  };

  const handleToggleReaction = (reactionType: HabitReactionType) => {
    if (!canReact || isPending) return;
    startTransition(async () => {
      const result = await toggleHabitReactionAction({
        ownerId,
        cycleKey: activeCycleKey,
        targetDateKey: null,
        reactionType,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["circle"], { ownerId });
    });
  };

  return (
    <section
      aria-label="Cycle review feedback"
      className="rounded-md border border-border bg-card"
    >
      {/* Header & Cycle Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold tracking-tight text-foreground">
            {isOwner ? "Circle Feedback & Replies" : `Review · ${ownerName}`}
          </h2>
          <Badge
            variant="outline"
            className="mono-tabular h-5 border-border px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {formatCycleDisplayLabel(activeCycleKey)}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {availableCycleKeys.length > 1 && onSelectCycle ? (
            <Select
              name="reviewCycle"
              value={activeCycleKey}
              onValueChange={onSelectCycle}
            >
              <SelectTrigger
                id="review-cycle-select"
                aria-label="Select review cycle"
                className="mono-tabular mira-row w-[180px] bg-background text-xs"
              >
                <SelectValue>{formatCycleDisplayLabel(activeCycleKey)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableCycleKeys.map((key) => (
                  <SelectItem
                    key={key}
                    value={key}
                    className="mono-tabular text-xs"
                  >
                    {formatCycleDisplayLabel(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {!isOwner && windowState ? (
            <span
              className={cn(
                "mono-tabular inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium",
                windowState.isOpen
                  ? "border-done/40 bg-done/10 text-done"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              {windowState.isOpen ? null : <Lock className="size-2.5" />}
              {windowState.summary}
            </span>
          ) : null}
        </div>
      </div>

      {/* Monochrome Reactions Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/50 px-4 py-2">
        <span className="text-[11px] text-muted-foreground">
          Cycle reactions
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {REACTION_META.map((meta) => {
            const Icon = meta.icon;
            const matching = reactions.filter(
              (r) =>
                r.reactionType === meta.type && r.targetDateKey === null
            );
            const activeByMe = matching.some(
              (r) => r.authorId === currentUserId
            );
            return (
              <button
                key={meta.type}
                type="button"
                disabled={!canReact || isPending}
                onClick={() => handleToggleReaction(meta.type)}
                aria-pressed={activeByMe}
                title={
                  canReact
                    ? `${meta.label} (${matching.length})`
                    : "Reactions locked until review window opens"
                }
                className={cn(
                  "mono-tabular inline-flex min-h-9 items-center gap-1.5 rounded border px-2.5 text-xs transition-colors md:min-h-7",
                  activeByMe
                    ? "border-foreground bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                  !canReact && "cursor-not-allowed opacity-50"
                )}
              >
                <Icon className="size-3" />
                <span>{meta.label}</span>
                {matching.length > 0 ? (
                  <span className="text-[10px] opacity-80">
                    {matching.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Comments & Replies Chronological Timeline */}
      <div className="p-4">
        {rootComments.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-muted-foreground">
            {isOwner
              ? "No review notes posted for this cycle yet."
              : windowState?.isOpen
                ? "No feedback yet for this cycle — leave an honest review note below."
                : "No feedback posted in this cycle yet."}
          </div>
        ) : (
          <ol aria-label="Cycle review timeline" className="relative space-y-0">
            {rootComments.map((comment, idx) => {
              const isLast = idx === rootComments.length - 1;
              const replies = repliesByParent.get(comment.id) ?? [];
              const canDelete =
                comment.authorId === currentUserId || isOwner;
              const isAuthorOwner = comment.authorId === ownerId;

              return (
                <li
                  key={comment.id}
                  className={cn(
                    "relative flex items-start gap-3 pl-0.5",
                    !isLast && "pb-4"
                  )}
                >
                  {!isLast ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-6 bottom-0 left-[13px] w-px bg-border"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                      isAuthorOwner
                        ? "border-border bg-card text-foreground"
                        : "border-collab/45 bg-collab/10 text-collab"
                    )}
                  >
                    <MessageSquare className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2.5 rounded-md border border-border/70 bg-background/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold text-foreground">
                        {comment.authorName}
                      </span>
                      {comment.authorId === ownerId ? (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1 text-[9px] font-normal"
                        >
                          Owner
                        </Badge>
                      ) : null}
                      <span className="mono-tabular text-[10px] text-muted-foreground">
                        {formatCommentTime(comment.createdAt, ownerTimezone)}
                      </span>
                      {comment.targetHabitTitle ? (
                        <Badge
                          variant="outline"
                          className="h-4 border-done/40 bg-done/10 px-1.5 text-[10px] font-normal text-done"
                        >
                          {comment.targetHabitTitle}
                        </Badge>
                      ) : null}
                      {comment.targetDateKey ? (
                        <Badge
                          variant="outline"
                          className="mono-tabular h-4 border-border px-1.5 text-[10px] font-normal text-muted-foreground"
                        >
                          {comment.targetDateKey}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                      {comment.body}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {canComment ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setReplyingToId((prev) =>
                            prev === comment.id ? null : comment.id
                          )
                        }
                        className="mira-row px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Reply
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete comment"
                        disabled={isPending}
                        onClick={() => handleDeleteComment(comment.id)}
                        className="mira-icon-btn text-muted-foreground hover:text-overdue"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Threaded Replies */}
                {replies.length > 0 ? (
                  <div className="space-y-2 border-l-2 border-border pl-3.5">
                    {replies.map((reply) => {
                      const canDeleteReply =
                        reply.authorId === currentUserId || isOwner;
                      return (
                        <div
                          key={reply.id}
                          className="flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <CornerDownRight className="size-3 text-muted-foreground" />
                              <span className="font-medium text-foreground">
                                {reply.authorName}
                              </span>
                              {reply.authorId === ownerId ? (
                                <Badge
                                  variant="secondary"
                                  className="h-4 px-1 text-[9px] font-normal"
                                >
                                  Owner
                                </Badge>
                              ) : null}
                              <span className="mono-tabular text-[10px] text-muted-foreground">
                                {formatCommentTime(
                                  reply.createdAt,
                                  ownerTimezone
                                )}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap pl-4 text-xs leading-relaxed text-foreground">
                              {reply.body}
                            </p>
                          </div>
                          {canDeleteReply ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Delete reply"
                              disabled={isPending}
                              onClick={() => handleDeleteComment(reply.id)}
                              className="mira-icon-btn shrink-0 text-muted-foreground hover:text-overdue"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Inline Reply Composer */}
                {replyingToId === comment.id && canComment ? (
                  <div className="space-y-2 border-l-2 border-border pl-3.5">
                    <Textarea
                      id={`reply-comment-${comment.id}`}
                      name="replyBody"
                      aria-label={`Reply to ${comment.authorName}`}
                      rows={2}
                      maxLength={1000}
                      placeholder={`Reply to ${comment.authorName}…`}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      className="bg-background text-xs"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setReplyingToId(null);
                          setReplyBody("");
                        }}
                        className="mira-row px-2.5 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        disabled={!replyBody.trim() || isPending}
                        onClick={() => handlePostReply(comment.id)}
                        className="mira-row px-3 text-xs"
                      >
                        Post reply
                      </Button>
                    </div>
                  </div>
                ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Bottom Composer OR Locked Window Banner */}
      <div className="border-t border-border bg-background/40 p-4">
        {canComment ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                name="reviewTargetHabit"
                value={targetHabitId}
                onValueChange={setTargetHabitId}
              >
                <SelectTrigger
                  id="review-target-habit"
                  aria-label="Anchor review note to habit"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue placeholder="Anchor to habit (optional)">
                    {targetHabitId === "none"
                      ? "General cycle note"
                      : `Habit: ${scopedHabits.find((h) => h.id === targetHabitId)?.title ?? "Selected"}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    General cycle note
                  </SelectItem>
                  {scopedHabits.map((h) => (
                    <SelectItem key={h.id} value={h.id} className="text-xs">
                      Habit: {h.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                id="review-target-date"
                name="reviewTargetDate"
                type="date"
                aria-label="Optional date cell anchor"
                value={targetDateKey}
                onChange={(e) => setTargetDateKey(e.target.value)}
                className="mono-tabular mira-row bg-background text-xs"
              />
            </div>

            <Textarea
              id="review-note-body"
              name="reviewBody"
              aria-label={isOwner ? "Personal cycle reflection" : `Review note for ${ownerName}`}
              rows={3}
              maxLength={1000}
              placeholder={
                isOwner
                  ? "Add a personal reflection for this cycle…"
                  : `Share constructive feedback on ${ownerName}'s progress…`
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="bg-background text-xs leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="mono-tabular text-[11px] text-muted-foreground">
                {body.length}/1000
              </span>
              <Button
                type="button"
                size="sm"
                disabled={!body.trim() || isPending}
                onClick={handlePostComment}
                className="mira-row gap-1.5 px-3.5 text-xs"
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {isOwner ? "Post reflection" : "Post review"}
              </Button>
            </div>
          </div>
        ) : (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3.5 py-3 text-xs"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Lock className="size-3.5 shrink-0" />
              <span>
                <strong className="font-medium text-foreground">
                  {windowState?.summary ?? "Commenting is currently locked"}
                </strong>{" "}
                <span className="mono-tabular">
                  ({ownerName}&apos;s time · {ownerTimezone})
                </span>
              </span>
            </div>
            {windowState?.allowReactionsWhenLocked ? (
              <span className="text-[11px] text-muted-foreground">
                Quiet reactions above remain available.
              </span>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
