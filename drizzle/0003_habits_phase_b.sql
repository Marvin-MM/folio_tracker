CREATE TABLE `habit_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`author_id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`target_date_key` text,
	`target_habit_id` text,
	`parent_comment_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `habit_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_comments_owner_cycle_created_idx` ON `habit_comments` (`owner_id`,`cycle_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `habit_comments_parent_idx` ON `habit_comments` (`parent_comment_id`);--> statement-breakpoint
CREATE INDEX `habit_comments_target_habit_idx` ON `habit_comments` (`target_habit_id`);--> statement-breakpoint
CREATE TABLE `habit_monitor_items` (
	`monitor_id` text NOT NULL,
	`habit_id` text NOT NULL,
	PRIMARY KEY(`monitor_id`, `habit_id`),
	FOREIGN KEY (`monitor_id`) REFERENCES `habit_monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_monitor_items_habit_idx` ON `habit_monitor_items` (`habit_id`);--> statement-breakpoint
CREATE TABLE `habit_monitor_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`target_user_id` text,
	`target_email` text NOT NULL,
	`token_hash` text,
	`scope` text DEFAULT 'all' NOT NULL,
	`selected_habit_ids_json` text DEFAULT '[]' NOT NULL,
	`proposed_policy_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_monitor_requests_scope_check" CHECK("habit_monitor_requests"."scope" IN ('all', 'selected')),
	CONSTRAINT "habit_monitor_requests_status_check" CHECK("habit_monitor_requests"."status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
	CONSTRAINT "habit_monitor_requests_no_self_check" CHECK("habit_monitor_requests"."target_user_id" IS NULL OR "habit_monitor_requests"."target_user_id" != "habit_monitor_requests"."owner_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_monitor_requests_token_hash_uq` ON `habit_monitor_requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `habit_monitor_requests_target_user_status_idx` ON `habit_monitor_requests` (`target_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `habit_monitor_requests_owner_status_idx` ON `habit_monitor_requests` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `habit_monitor_requests_target_email_status_idx` ON `habit_monitor_requests` (`target_email`,`status`);--> statement-breakpoint
CREATE TABLE `habit_monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`monitor_user_id` text NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`use_custom_policy` integer DEFAULT false NOT NULL,
	`custom_comment_mode` text,
	`custom_window_start_day` integer,
	`custom_window_start_time` text,
	`custom_window_end_day` integer,
	`custom_window_end_time` text,
	`custom_interval_days` integer,
	`custom_interval_anchor_date` text,
	`custom_interval_open_hours` integer,
	`custom_allow_reactions_when_locked` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_monitors_no_self_check" CHECK("habit_monitors"."owner_id" != "habit_monitors"."monitor_user_id"),
	CONSTRAINT "habit_monitors_scope_check" CHECK("habit_monitors"."scope" IN ('all', 'selected')),
	CONSTRAINT "habit_monitors_status_check" CHECK("habit_monitors"."status" IN ('active', 'revoked')),
	CONSTRAINT "habit_monitors_custom_mode_check" CHECK("habit_monitors"."custom_comment_mode" IS NULL OR "habit_monitors"."custom_comment_mode" IN ('weekly_window', 'interval_days', 'anytime')),
	CONSTRAINT "habit_monitors_custom_start_day_check" CHECK("habit_monitors"."custom_window_start_day" IS NULL OR ("habit_monitors"."custom_window_start_day" >= 0 AND "habit_monitors"."custom_window_start_day" <= 6)),
	CONSTRAINT "habit_monitors_custom_end_day_check" CHECK("habit_monitors"."custom_window_end_day" IS NULL OR ("habit_monitors"."custom_window_end_day" >= 0 AND "habit_monitors"."custom_window_end_day" <= 6)),
	CONSTRAINT "habit_monitors_custom_interval_days_check" CHECK("habit_monitors"."custom_interval_days" IS NULL OR ("habit_monitors"."custom_interval_days" >= 2 AND "habit_monitors"."custom_interval_days" <= 30)),
	CONSTRAINT "habit_monitors_custom_open_hours_check" CHECK("habit_monitors"."custom_interval_open_hours" IS NULL OR ("habit_monitors"."custom_interval_open_hours" >= 1 AND "habit_monitors"."custom_interval_open_hours" <= 168))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_monitors_owner_monitor_uq` ON `habit_monitors` (`owner_id`,`monitor_user_id`);--> statement-breakpoint
CREATE INDEX `habit_monitors_monitor_status_idx` ON `habit_monitors` (`monitor_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `habit_monitors_owner_status_idx` ON `habit_monitors` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `habit_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`author_id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`target_date_key` text,
	`reaction_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_reactions_type_check" CHECK("habit_reactions"."reaction_type" IN ('ack', 'solid', 'push'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_reactions_day_uq` ON `habit_reactions` (`owner_id`,`author_id`,`cycle_key`,`target_date_key`,`reaction_type`) WHERE "habit_reactions"."target_date_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `habit_reactions_cycle_uq` ON `habit_reactions` (`owner_id`,`author_id`,`cycle_key`,`reaction_type`) WHERE "habit_reactions"."target_date_key" IS NULL;--> statement-breakpoint
CREATE INDEX `habit_reactions_owner_cycle_idx` ON `habit_reactions` (`owner_id`,`cycle_key`);--> statement-breakpoint
CREATE TABLE `habit_weekly_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`period_start_date` text NOT NULL,
	`period_end_date` text NOT NULL,
	`metrics_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_weekly_snapshots_owner_cycle_uq` ON `habit_weekly_snapshots` (`owner_id`,`cycle_key`);