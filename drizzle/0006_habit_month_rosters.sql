CREATE TABLE `habit_month_rosters` (
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`year_month` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `habit_id`, `year_month`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_month_rosters_user_month_idx` ON `habit_month_rosters` (`user_id`,`year_month`);--> statement-breakpoint
CREATE INDEX `habit_month_rosters_habit_idx` ON `habit_month_rosters` (`habit_id`,`year_month`);