"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, CheckCheck, Clock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/actions/notifications";
import { snoozeReminderAction } from "@/actions/reminders";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { SnoozePreset } from "@/lib/reminder-presets";
import { cn } from "@/lib/utils";
import type { NotificationRecord } from "@/server/db/schema";

interface NotificationBellProps {
  initialNotifications: NotificationRecord[];
  timezone: string;
}

function parseEntityAndReminderId(rawEntityId: string | null): {
  entityId: string | null;
  reminderId: string | null;
} {
  if (!rawEntityId) return { entityId: null, reminderId: null };
  const parts = rawEntityId.split("::");
  return {
    entityId: parts[0] ?? null,
    reminderId: parts[1] ?? null,
  };
}

function getDeepLink(notif: NotificationRecord): string {
  const { entityId } = parseEntityAndReminderId(notif.entityId);
  if (notif.type === "reminder.test") {
    return "/app/settings/notifications";
  }
  if (notif.entityType === "note" && entityId) {
    return `/app/notes?item=${encodeURIComponent(entityId)}`;
  }
  if (notif.entityType === "task" && entityId) {
    return `/app/inbox?item=${encodeURIComponent(entityId)}`;
  }
  return "/app/reminders";
}

function formatCreatedAt(ms: number, timezone: string): string {
  try {
    return formatInTimeZone(ms, timezone, "MMM d · HH:mm");
  } catch {
    return formatInTimeZone(ms, "UTC", "MMM d · HH:mm");
  }
}

export function NotificationBell({
  initialNotifications,
  timezone,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [optimisticItems, applyOptimistic] = useOptimistic<
    NotificationRecord[],
    { type: "mark_one"; id: string } | { type: "mark_all" }
  >(initialNotifications, (state, action) => {
    if (action.type === "mark_all") {
      return state.map((item) => ({ ...item, isRead: true }));
    }
    return state.map((item) =>
      item.id === action.id ? { ...item, isRead: true } : item
    );
  });

  const unreadCount = optimisticItems.filter((n) => !n.isRead).length;

  const handleMarkAllRead = () => {
    if (unreadCount === 0) return;
    startTransition(async () => {
      applyOptimistic({ type: "mark_all" });
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        toast.error(result.error.message);
      }
    });
  };

  const handleMarkOneRead = (id: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "mark_one", id });
      const result = await markNotificationReadAction({ notificationId: id });
      if (!result.ok) {
        toast.error(result.error.message);
      }
    });
  };

  const handleSnooze = (
    notificationId: string,
    reminderId: string,
    preset: SnoozePreset
  ) => {
    startTransition(async () => {
      applyOptimistic({ type: "mark_one", id: notificationId });
      const [snoozeRes] = await Promise.all([
        snoozeReminderAction({ reminderId, preset }),
        markNotificationReadAction({ notificationId }),
      ]);

      if (!snoozeRes.ok) {
        toast.error(snoozeRes.error.message);
        return;
      }

      toast.success(
        `Snoozed until ${formatCreatedAt(snoozeRes.data.remindAt, timezone)}`
      );
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : "Notifications"
          }
          className="mira-icon-btn relative text-muted-foreground hover:text-foreground"
        >
          <Bell className="size-3.5" />
          {unreadCount > 0 ? (
            <span className="mono-tabular absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-reminder px-1 text-[9px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[340px] border-border bg-popover p-0"
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              Notifications
            </span>
            {unreadCount > 0 ? (
              <span className="mono-tabular rounded bg-reminder/15 px-1.5 py-0.5 text-[10px] font-medium text-reminder">
                {unreadCount} unread
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0 || isPending}
            onClick={handleMarkAllRead}
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <CheckCheck className="size-3" />
            Mark all read
          </Button>
        </div>

        <Separator />

        <div className="max-h-80 divide-y divide-border overflow-y-auto">
          {optimisticItems.length === 0 ? (
            <div className="px-4 py-7 text-center text-xs text-muted-foreground">
              No notifications yet. Triggered reminders will appear here.
            </div>
          ) : (
            optimisticItems.map((item) => {
              const { reminderId } = parseEntityAndReminderId(item.entityId);
              const deepLink = getDeepLink(item);

              return (
                <div
                  key={item.id}
                  className={cn(
                    "space-y-1.5 px-3 py-2.5 text-xs transition-colors",
                    !item.isRead && "bg-accent/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {item.body}
                      </p>
                    </div>
                    <span className="mono-tabular shrink-0 text-[10px] text-muted-foreground">
                      {formatCreatedAt(item.createdAt, timezone)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <div className="flex items-center gap-1">
                      {reminderId ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            onClick={() =>
                              handleSnooze(item.id, reminderId, "15m")
                            }
                            className="mono-tabular h-5 px-1.5 text-[10px]"
                          >
                            <Clock className="mr-0.5 size-2.5 text-reminder" />
                            +15m
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            onClick={() =>
                              handleSnooze(item.id, reminderId, "1h")
                            }
                            className="mono-tabular h-5 px-1.5 text-[10px]"
                          >
                            +1h
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            onClick={() =>
                              handleSnooze(item.id, reminderId, "tomorrow_9am")
                            }
                            className="h-5 px-1.5 text-[10px]"
                          >
                            Tom 9 AM
                          </Button>
                        </>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!item.isRead ? (
                        <button
                          type="button"
                          onClick={() => handleMarkOneRead(item.id)}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Mark read
                        </button>
                      ) : null}
                      <Link
                        href={deepLink}
                        onClick={() => {
                          if (!item.isRead) handleMarkOneRead(item.id);
                          setOpen(false);
                        }}
                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        Open
                        <ExternalLink className="size-2.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Separator />
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
          <Link
            href="/app/reminders"
            onClick={() => setOpen(false)}
            className="hover:text-foreground"
          >
            All reminders
          </Link>
          <Link
            href="/app/settings/notifications"
            onClick={() => setOpen(false)}
            className="hover:text-foreground"
          >
            Push settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
