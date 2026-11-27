CREATE TABLE `operation_reference_notes` (
	`operation_id` text NOT NULL,
	`note_id` text NOT NULL,
	PRIMARY KEY(`operation_id`, `note_id`),
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operation_reference_notes_note_id_idx` ON `operation_reference_notes` (`note_id`);--> statement-breakpoint
CREATE TABLE `operation_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `operation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_run_steps_status_check" CHECK("operation_run_steps"."status" IN ('pending', 'done', 'skipped', 'blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_run_steps_run_step_key_uidx` ON `operation_run_steps` (`run_id`,`step_key`);--> statement-breakpoint
CREATE TABLE `operation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`version_id` text NOT NULL,
	`runner_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`variables_values_json` text DEFAULT '{}' NOT NULL,
	`prerequisites_checked_json` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `operation_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_runs_status_check" CHECK("operation_runs"."status" IN ('in_progress', 'completed', 'abandoned'))
);
--> statement-breakpoint
CREATE INDEX `operation_runs_runner_status_updated_idx` ON `operation_runs` (`runner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `operation_runs_operation_runner_idx` ON `operation_runs` (`operation_id`,`runner_id`);--> statement-breakpoint
CREATE TABLE `operation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`variables_schema_json` text DEFAULT '[]' NOT NULL,
	`prerequisites_json` text DEFAULT '[]' NOT NULL,
	`steps_snapshot_json` text DEFAULT '[]' NOT NULL,
	`change_summary` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operation_versions_version_number_check" CHECK("operation_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_versions_operation_version_uidx` ON `operation_versions` (`operation_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`linked_habit_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`domain` text DEFAULT 'general' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`difficulty` text,
	`estimated_minutes` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`unlisted_token_hash` text,
	`allow_forking` integer DEFAULT true NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`edit_version` integer DEFAULT 1 NOT NULL,
	`forked_from_id` text,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`review_cycle_days` integer,
	`last_verified_at` integer,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`forked_from_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operations_domain_check" CHECK("operations"."domain" IN ('general', 'tech', 'cooking', 'fitness', 'diy', 'business', 'study')),
	CONSTRAINT "operations_difficulty_check" CHECK("operations"."difficulty" IS NULL OR "operations"."difficulty" IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "operations_visibility_check" CHECK("operations"."visibility" IN ('private', 'unlisted', 'public')),
	CONSTRAINT "operations_current_version_check" CHECK("operations"."current_version" >= 1),
	CONSTRAINT "operations_edit_version_check" CHECK("operations"."edit_version" >= 1),
	CONSTRAINT "operations_fork_count_check" CHECK("operations"."fork_count" >= 0),
	CONSTRAINT "operations_estimated_minutes_check" CHECK("operations"."estimated_minutes" IS NULL OR "operations"."estimated_minutes" >= 1),
	CONSTRAINT "operations_review_cycle_days_check" CHECK("operations"."review_cycle_days" IS NULL OR "operations"."review_cycle_days" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_slug_unique` ON `operations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_unlisted_token_hash_unique` ON `operations` (`unlisted_token_hash`);--> statement-breakpoint
CREATE INDEX `operations_owner_archived_updated_idx` ON `operations` (`owner_id`,`is_archived`,`updated_at`);--> statement-breakpoint
CREATE INDEX `operations_visibility_domain_updated_idx` ON `operations` (`visibility`,`domain`,`updated_at`);--> statement-breakpoint
CREATE INDEX `operations_project_id_idx` ON `operations` (`project_id`);--> statement-breakpoint
CREATE INDEX `operations_linked_habit_id_idx` ON `operations` (`linked_habit_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `operation_id` text REFERENCES operations(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `operation_run_id` text REFERENCES operation_runs(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `tasks_operation_id_idx` ON `tasks` (`operation_id`);--> statement-breakpoint
CREATE INDEX `tasks_operation_run_id_idx` ON `tasks` (`operation_run_id`);