CREATE TABLE `habit_import_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`source_title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`first_seen_date_key` text NOT NULL,
	`last_seen_date_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_import_alias_user_title_uq` ON `habit_import_aliases` (`user_id`,`normalized_title`);--> statement-breakpoint
CREATE INDEX `habit_import_alias_user_habit_idx` ON `habit_import_aliases` (`user_id`,`habit_id`);
