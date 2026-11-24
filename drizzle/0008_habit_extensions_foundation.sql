CREATE TABLE `habit_excuse_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text NOT NULL,
	`habit_ids_json` text NOT NULL DEFAULT '[]',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `habit_excuse_ranges_date_order_check` CHECK (`start_date` <= `end_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_excuse_ranges_user_dates_idx` ON `habit_excuse_ranges` (`user_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `habit_excuse_ranges_user_deleted_idx` ON `habit_excuse_ranges` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `habit_day_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`energy` integer,
	`sleep_hours` real,
	`note` text,
	`journal_prompt_id` text,
	`journal_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `habit_day_entries_energy_check` CHECK (`energy` IS NULL OR (`energy` >= 1 AND `energy` <= 10)),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_day_entries_user_date_uq` ON `habit_day_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `habit_day_entries_user_deleted_idx` ON `habit_day_entries` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `undo_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `undo_snapshots_user_expiry_idx` ON `undo_snapshots` (`user_id`,`expires_at`);
