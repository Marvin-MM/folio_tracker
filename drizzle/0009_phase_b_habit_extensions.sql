-- Additive metadata columns first so the CHECK-constrained table rebuild below
-- can copy existing rows (including their legacy titles/categories).
ALTER TABLE `habits` ADD `energy_need` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `place` text DEFAULT 'anywhere' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `habit_logs` ADD `miss_reason` text;--> statement-breakpoint
ALTER TABLE `habit_logs` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE TABLE `habit_saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'today' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`filter_json` text DEFAULT '{}' NOT NULL,
	`group_by` text DEFAULT 'none' NOT NULL,
	`sort_by` text DEFAULT 'order' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_saved_views_name_check" CHECK(length("habit_saved_views"."name") BETWEEN 1 AND 48),
	CONSTRAINT "habit_saved_views_kind_check" CHECK("habit_saved_views"."kind" IN ('today', 'grid', 'calendar', 'board')),
	CONSTRAINT "habit_saved_views_group_by_check" CHECK("habit_saved_views"."group_by" IN ('timeBlock', 'category', 'energyNeed', 'place', 'none')),
	CONSTRAINT "habit_saved_views_sort_by_check" CHECK("habit_saved_views"."sort_by" IN ('order', 'rate', 'streak'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_saved_views_user_name_uq` ON `habit_saved_views` (`user_id`,`name`) WHERE "habit_saved_views"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `habit_saved_views_user_deleted_idx` ON `habit_saved_views` (`user_id`,`deleted_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date_key` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`miss_reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`logged_at` integer NOT NULL,
	`is_backfilled_late` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_logs_status_check" CHECK("__new_habit_logs"."status" IN ('done', 'missed', 'skipped')),
	CONSTRAINT "habit_logs_miss_reason_check" CHECK("__new_habit_logs"."miss_reason" IS NULL OR "__new_habit_logs"."miss_reason" IN ('tired', 'work', 'travel', 'forgot', 'sick', 'low_motivation', 'other')),
	CONSTRAINT "habit_logs_source_check" CHECK("__new_habit_logs"."source" IN ('manual', 'rule', 'button', 'range'))
);
--> statement-breakpoint
INSERT INTO `__new_habit_logs`("id", "habit_id", "user_id", "date_key", "status", "note", "miss_reason", "source", "logged_at", "is_backfilled_late") SELECT "id", "habit_id", "user_id", "date_key", "status", "note", "miss_reason", "source", "logged_at", "is_backfilled_late" FROM `habit_logs`;--> statement-breakpoint
DROP TABLE `habit_logs`;--> statement-breakpoint
ALTER TABLE `__new_habit_logs` RENAME TO `habit_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `habit_logs_habit_date_uq` ON `habit_logs` (`habit_id`,`date_key`);--> statement-breakpoint
CREATE INDEX `habit_logs_user_date_idx` ON `habit_logs` (`user_id`,`date_key`);--> statement-breakpoint
CREATE TABLE `__new_habits` (
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
	`energy_need` text DEFAULT 'medium' NOT NULL,
	`place` text DEFAULT 'anywhere' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`linked_project_id` text,
	`auto_sync_daily_task` integer DEFAULT false NOT NULL,
	`position` text DEFAULT 'n' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "habits_cadence_type_check" CHECK("__new_habits"."cadence_type" IN ('daily', 'specific_days', 'weekly_target')),
	CONSTRAINT "habits_weekly_target_check" CHECK("__new_habits"."weekly_target_count" IS NULL OR ("__new_habits"."weekly_target_count" >= 1 AND "__new_habits"."weekly_target_count" <= 7)),
	CONSTRAINT "habits_energy_need_check" CHECK("__new_habits"."energy_need" IN ('low', 'medium', 'high')),
	CONSTRAINT "habits_place_check" CHECK("__new_habits"."place" IN ('home', 'commute', 'work', 'anywhere'))
);
--> statement-breakpoint
INSERT INTO `__new_habits`("id", "user_id", "title", "description", "category", "cadence_type", "scheduled_days_json", "weekly_target_count", "start_date", "preferred_time", "energy_need", "place", "tags_json", "linked_project_id", "auto_sync_daily_task", "position", "is_archived", "created_at", "updated_at") SELECT "id", "user_id", "title", "description", "category", "cadence_type", "scheduled_days_json", "weekly_target_count", "start_date", "preferred_time", "energy_need", "place", "tags_json", "linked_project_id", "auto_sync_daily_task", "position", "is_archived", "created_at", "updated_at" FROM `habits`;--> statement-breakpoint
DROP TABLE `habits`;--> statement-breakpoint
ALTER TABLE `__new_habits` RENAME TO `habits`;--> statement-breakpoint
CREATE INDEX `habits_user_archived_pos_idx` ON `habits` (`user_id`,`is_archived`,`position`);--> statement-breakpoint
CREATE INDEX `habits_archived_preferred_time_idx` ON `habits` (`is_archived`,`preferred_time`);