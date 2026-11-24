PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_habit_tracker_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`default_comment_mode` text DEFAULT 'weekly_window' NOT NULL,
	`default_window_start_day` integer DEFAULT 6 NOT NULL,
	`default_window_start_time` text DEFAULT '00:00' NOT NULL,
	`default_window_end_day` integer DEFAULT 0 NOT NULL,
	`default_window_end_time` text DEFAULT '23:59' NOT NULL,
	`default_interval_days` integer,
	`default_interval_anchor_date` text,
	`default_interval_open_hours` integer DEFAULT 24 NOT NULL,
	`allow_reactions_when_locked` integer DEFAULT true NOT NULL,
	`evening_checkin_time` text,
	`partner_nudges_enabled` integer DEFAULT false NOT NULL,
	`partner_nudge_start_hour` integer DEFAULT 18 NOT NULL,
	`partner_nudge_min_streak` integer DEFAULT 2 NOT NULL,
	`nudge_quiet_hours_start` text DEFAULT '21:00' NOT NULL,
	`nudge_quiet_hours_end` text DEFAULT '08:00' NOT NULL,
	`month_lock_enabled` integer DEFAULT true NOT NULL,
	`month_lock_grace_days` integer DEFAULT 3 NOT NULL,
	`month_lock_pin_hash` text,
	`month_lock_pin_salt` text,
	`month_lock_pin_failed_attempts` integer DEFAULT 0 NOT NULL,
	`month_lock_pin_locked_until` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_settings_week_starts_on_check" CHECK("__new_habit_tracker_settings"."week_starts_on" IN (0, 1)),
	CONSTRAINT "habit_settings_comment_mode_check" CHECK("__new_habit_tracker_settings"."default_comment_mode" IN ('weekly_window', 'interval_days', 'anytime')),
	CONSTRAINT "habit_settings_window_start_day_check" CHECK("__new_habit_tracker_settings"."default_window_start_day" >= 0 AND "__new_habit_tracker_settings"."default_window_start_day" <= 6),
	CONSTRAINT "habit_settings_window_end_day_check" CHECK("__new_habit_tracker_settings"."default_window_end_day" >= 0 AND "__new_habit_tracker_settings"."default_window_end_day" <= 6),
	CONSTRAINT "habit_settings_interval_days_check" CHECK("__new_habit_tracker_settings"."default_interval_days" IS NULL OR "__new_habit_tracker_settings"."default_interval_days" >= 1),
	CONSTRAINT "habit_settings_interval_open_hours_check" CHECK("__new_habit_tracker_settings"."default_interval_open_hours" >= 1),
	CONSTRAINT "habit_settings_partner_nudge_start_hour_check" CHECK("__new_habit_tracker_settings"."partner_nudge_start_hour" >= 0 AND "__new_habit_tracker_settings"."partner_nudge_start_hour" <= 23),
	CONSTRAINT "habit_settings_partner_nudge_min_streak_check" CHECK("__new_habit_tracker_settings"."partner_nudge_min_streak" >= 1 AND "__new_habit_tracker_settings"."partner_nudge_min_streak" <= 365),
	CONSTRAINT "habit_settings_month_lock_grace_days_check" CHECK("__new_habit_tracker_settings"."month_lock_grace_days" >= 0 AND "__new_habit_tracker_settings"."month_lock_grace_days" <= 14),
	CONSTRAINT "habit_settings_pin_failed_attempts_check" CHECK("__new_habit_tracker_settings"."month_lock_pin_failed_attempts" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_habit_tracker_settings`("user_id", "week_starts_on", "default_comment_mode", "default_window_start_day", "default_window_start_time", "default_window_end_day", "default_window_end_time", "default_interval_days", "default_interval_anchor_date", "default_interval_open_hours", "allow_reactions_when_locked", "evening_checkin_time", "partner_nudges_enabled", "partner_nudge_start_hour", "partner_nudge_min_streak", "nudge_quiet_hours_start", "nudge_quiet_hours_end", "month_lock_enabled", "month_lock_grace_days", "month_lock_pin_hash", "month_lock_pin_salt", "month_lock_pin_failed_attempts", "month_lock_pin_locked_until", "updated_at") SELECT "user_id", "week_starts_on", "default_comment_mode", "default_window_start_day", "default_window_start_time", "default_window_end_day", "default_window_end_time", "default_interval_days", "default_interval_anchor_date", "default_interval_open_hours", "allow_reactions_when_locked", "evening_checkin_time", false, 18, 2, '21:00', '08:00', "month_lock_enabled", "month_lock_grace_days", "month_lock_pin_hash", "month_lock_pin_salt", "month_lock_pin_failed_attempts", "month_lock_pin_locked_until", "updated_at" FROM `habit_tracker_settings`;--> statement-breakpoint
DROP TABLE `habit_tracker_settings`;--> statement-breakpoint
ALTER TABLE `__new_habit_tracker_settings` RENAME TO `habit_tracker_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;