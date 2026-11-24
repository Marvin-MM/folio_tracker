"use client";

import { useMemo, type ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Activity, ArrowUpRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TimelineTone = "neutral" | "done" | "reminder" | "collab" | "overdue";

export interface ActivityTimelineItem {
  id: string;
  category: string;
  tone: TimelineTone;
  icon: ReactNode;
  title: string;
  detail?: string | null;
  actorName?: string | null;
  badgeLabel?: string | null;
  createdAtMs: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ActivityTimelineFilterOption {
  value: string;
  label: string;
  count?: number;
}

interface ActivityTimelineProps {
  items: ActivityTimelineItem[];
  timezone: string;
  referenceUtcMs: number;
  emptyTitle?: string;
  emptyDescription?: string;
  filters?: ActivityTimelineFilterOption[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
  ariaLabel?: string;
}

const NODE_TONE_CLASSES: Record<TimelineTone, string> = {
  neutral: "border-border bg-card text-foreground",
  done: "border-done/45 bg-done/10 text-done",
  reminder: "border-reminder/45 bg-reminder/10 text-reminder",
  collab: "border-collab/45 bg-collab/10 text-collab",
  overdue: "border-overdue/45 bg-overdue/10 text-overdue",
};

const BADGE_TONE_CLASSES: Record<TimelineTone, string> = {
  neutral: "border-border text-muted-foreground",
  done: "border-done/35 bg-done/10 text-done",
  reminder: "border-reminder/35 bg-reminder/10 text-reminder",
  collab: "border-collab/35 bg-collab/10 text-collab",
  overdue: "border-overdue/35 bg-overdue/10 text-overdue",
};

function getCleanInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function safeFormat(ms: number, timezone: string, pattern: string): string {
  try {
    return formatInTimeZone(ms, timezone, pattern);
  } catch {
    return formatInTimeZone(ms, "UTC", pattern);
  }
}

function formatRelativeAge(createdAtMs: number, referenceUtcMs: number): string {
  const diffSec = Math.max(0, Math.floor((referenceUtcMs - createdAtMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Reusable Mira Chronological Activity Timeline.
 * Groups events by calendar day in the viewer's IANA timezone along a crisp
 * vertical hairline spine with semantic icon nodes, actor chips, filter pills,
 * exact tabular timestamps, and optional inspector deep-link buttons.
 */
export function ActivityTimeline({
  items,
  timezone,
  referenceUtcMs,
  emptyTitle = "No activity recorded yet",
  emptyDescription = "Chronological events will appear here as activity occurs.",
  filters,
  activeFilter,
  onFilterChange,
  ariaLabel = "Chronological activity timeline",
}: ActivityTimelineProps) {
  const dayGroups = useMemo(() => {
    const todayKey = safeFormat(referenceUtcMs, timezone, "yyyy-MM-dd");
    const yesterdayKey = safeFormat(
      referenceUtcMs - 24 * 60 * 60 * 1000,
      timezone,
      "yyyy-MM-dd"
    );

    const groups: Array<{
      dateKey: string;
      label: string;
      entries: ActivityTimelineItem[];
    }> = [];
    const byKey = new Map<string, (typeof groups)[number]>();

    for (const item of items) {
      const dateKey = safeFormat(item.createdAtMs, timezone, "yyyy-MM-dd");
      let group = byKey.get(dateKey);
      if (!group) {
        const label =
          dateKey === todayKey
            ? "Today"
            : dateKey === yesterdayKey
              ? "Yesterday"
              : safeFormat(item.createdAtMs, timezone, "EEE, MMM d, yyyy");
        group = { dateKey, label, entries: [] };
        byKey.set(dateKey, group);
        groups.push(group);
      }
      group.entries.push(item);
    }

    return groups;
  }, [items, referenceUtcMs, timezone]);

  return (
    <div className="space-y-3">
      {filters && filters.length > 0 && onFilterChange ? (
        <div
          role="group"
          aria-label="Filter timeline categories"
          className="flex flex-wrap items-center gap-1.5"
        >
          {filters.map((filter) => {
            const isActive = activeFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onFilterChange(filter.value)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors md:min-h-7",
                  isActive
                    ? "border-foreground bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{filter.label}</span>
                {typeof filter.count === "number" ? (
                  <span
                    className={cn(
                      "mono-tabular text-[10px]",
                      isActive
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground"
                    )}
                  >
                    {filter.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {dayGroups.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
          <Activity
            className="mx-auto size-5 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-2.5 text-xs font-medium text-foreground">
            {emptyTitle}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {emptyDescription}
          </p>
        </div>
      ) : (
        <div
          aria-label={ariaLabel}
          className="space-y-4 rounded-md border border-border bg-card p-3.5 sm:p-4"
        >
          {dayGroups.map((group) => (
            <section key={group.dateKey} className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
                <span className="mono-tabular text-[10px] text-muted-foreground">
                  {group.entries.length}{" "}
                  {group.entries.length === 1 ? "event" : "events"}
                </span>
              </div>

              <ol className="relative space-y-0">
                {group.entries.map((entry, idx) => {
                  const isLast = idx === group.entries.length - 1;
                  const timeShort = safeFormat(
                    entry.createdAtMs,
                    timezone,
                    "HH:mm"
                  );
                  const fullStamp = safeFormat(
                    entry.createdAtMs,
                    timezone,
                    "MMM d, yyyy · HH:mm"
                  );
                  const relative = formatRelativeAge(
                    entry.createdAtMs,
                    referenceUtcMs
                  );

                  return (
                    <li
                      key={entry.id}
                      className={cn(
                        "relative flex items-start gap-3 pl-1",
                        !isLast && "pb-3.5"
                      )}
                    >
                      {/* Vertical Hairline Timeline Spine */}
                      {!isLast ? (
                        <span
                          aria-hidden="true"
                          className="absolute top-6 bottom-0 left-[15px] w-px bg-border"
                        />
                      ) : null}

                      {/* Semantic Circular Event Node */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                          NODE_TONE_CLASSES[entry.tone]
                        )}
                      >
                        {entry.icon}
                      </span>

                      {/* Event Card Content */}
                      <div className="min-w-0 flex-1 rounded-md border border-border/70 bg-background/60 px-3 py-2 transition-colors hover:border-border">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {entry.actorName ? (
                                <Avatar className="size-4 shrink-0 border border-border">
                                  <AvatarFallback className="bg-muted text-[8px] font-medium text-foreground">
                                    {getCleanInitials(entry.actorName)}
                                  </AvatarFallback>
                                </Avatar>
                              ) : null}
                              <p className="text-xs font-medium text-foreground">
                                {entry.title}
                              </p>
                              {entry.badgeLabel ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "h-4 px-1.5 text-[10px] font-normal",
                                    BADGE_TONE_CLASSES[entry.tone]
                                  )}
                                >
                                  {entry.badgeLabel}
                                </Badge>
                              ) : null}
                            </div>

                            {entry.detail ? (
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                {entry.detail}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {entry.onAction ? (
                              <button
                                type="button"
                                onClick={entry.onAction}
                                className="inline-flex min-h-9 items-center gap-0.5 rounded border border-border bg-card px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent md:min-h-6"
                              >
                                {entry.actionLabel ?? "Inspect"}
                                <ArrowUpRight
                                  className="size-3"
                                  aria-hidden="true"
                                />
                              </button>
                            ) : null}

                            <time
                              dateTime={new Date(
                                entry.createdAtMs
                              ).toISOString()}
                              title={fullStamp}
                              className="mono-tabular text-[10px] text-muted-foreground"
                            >
                              {timeShort} · {relative}
                            </time>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
