CREATE TABLE `habit_group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `habit_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_group_members_role_check" CHECK("habit_group_members"."role" IN ('owner', 'admin', 'member')),
	CONSTRAINT "habit_group_members_status_check" CHECK("habit_group_members"."status" IN ('active', 'invited', 'left'))
);
--> statement-breakpoint
CREATE INDEX `habit_group_members_user_status_idx` ON `habit_group_members` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `habit_group_members_group_status_idx` ON `habit_group_members` (`group_id`,`status`);--> statement-breakpoint
CREATE TABLE `habit_group_shared_habits` (
	`group_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`shared_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `habit_id`),
	FOREIGN KEY (`group_id`) REFERENCES `habit_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_group_shared_habits_habit_idx` ON `habit_group_shared_habits` (`habit_id`);--> statement-breakpoint
CREATE TABLE `habit_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_groups_name_check" CHECK(length("habit_groups"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX `habit_groups_owner_idx` ON `habit_groups` (`owner_id`);