CREATE TABLE `habit_group_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`period_start_date` text NOT NULL,
	`period_end_date` text NOT NULL,
	`author_id` text NOT NULL,
	`went_well` text NOT NULL,
	`challenges` text NOT NULL,
	`next_focus` text NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `habit_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_group_reviews_group_cycle_author_uq` ON `habit_group_reviews` (`group_id`,`cycle_key`,`author_id`);--> statement-breakpoint
CREATE INDEX `habit_group_reviews_group_cycle_idx` ON `habit_group_reviews` (`group_id`,`cycle_key`);