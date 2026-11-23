export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType:
    | "task"
    | "note"
    | "habit"
    | "habit_nudge"
    | "habit_monitor_request"
    | "habit_review"
    | "habit_comment";
  entityId: string;
  reminderId?: string;
  deepLink: string;
  remindAt?: number;
  timezone?: string;
}

export interface NotificationDispatchResult {
  channel: string;
  delivered: boolean;
  skipped?: boolean;
  removedEndpoints?: string[];
  detail?: string;
}

export interface NotificationChannel {
  readonly name: string;
  send(payload: NotificationPayload): Promise<NotificationDispatchResult>;
}
