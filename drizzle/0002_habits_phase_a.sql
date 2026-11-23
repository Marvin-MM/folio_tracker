CREATE TABLE `habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date_key` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`logged_at` integer NOT NULL,
	`is_backfilled_late` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_logs_status_check" CHECK("habit_logs"."status" IN ('done', 'missed', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_logs_habit_date_uq` ON `habit_logs` (`habit_id`,`date_key`);--> statement-breakpoint
CREATE INDEX `habit_logs_user_date_idx` ON `habit_logs` (`user_id`,`date_key`);--> statement-breakpoint
CREATE TABLE `habit_tracker_settings` (
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
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_settings_week_starts_on_check" CHECK("habit_tracker_settings"."week_starts_on" IN (0, 1)),
	CONSTRAINT "habit_settings_comment_mode_check" CHECK("habit_tracker_settings"."default_comment_mode" IN ('weekly_window', 'interval_days', 'anytime')),
	CONSTRAINT "habit_settings_window_start_day_check" CHECK("habit_tracker_settings"."default_window_start_day" >= 0 AND "habit_tracker_settings"."default_window_start_day" <= 6),
	CONSTRAINT "habit_settings_window_end_day_check" CHECK("habit_tracker_settings"."default_window_end_day" >= 0 AND "habit_tracker_settings"."default_window_end_day" <= 6),
	CONSTRAINT "habit_settings_interval_days_check" CHECK("habit_tracker_settings"."default_interval_days" IS NULL OR "habit_tracker_settings"."default_interval_days" >= 1),
	CONSTRAINT "habit_settings_interval_open_hours_check" CHECK("habit_tracker_settings"."default_interval_open_hours" >= 1)
);
--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`cadence_type` text DEFAULT 'daily' NOT NULL,
	`scheduled_days_json` text DEFAULT '[]' NOT NULL,
	`weekly_target_count` integer,
	`start_date` text NOT NULL,
	`preferred_time` text,
	`linked_project_id` text,
	`auto_sync_daily_task` integer DEFAULT false NOT NULL,
	`position` text DEFAULT 'n' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "habits_cadence_type_check" CHECK("habits"."cadence_type" IN ('daily', 'specific_days', 'weekly_target')),
	CONSTRAINT "habits_weekly_target_check" CHECK("habits"."weekly_target_count" IS NULL OR ("habits"."weekly_target_count" >= 1 AND "habits"."weekly_target_count" <= 7))
);
--> statement-breakpoint
CREATE INDEX `habits_user_archived_pos_idx` ON `habits` (`user_id`,`is_archived`,`position`);--> statement-breakpoint
CREATE INDEX `habits_archived_preferred_time_idx` ON `habits` (`is_archived`,`preferred_time`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `habit_id` text REFERENCES habits(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `habit_date_key` text;--> statement-breakpoint
CREATE INDEX `tasks_habit_date_idx` ON `tasks` (`habit_id`,`habit_date_key`);