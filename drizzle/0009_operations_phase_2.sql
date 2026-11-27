CREATE TABLE `operation_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`invited_by_id` text NOT NULL,
	`target_user_id` text,
	`target_email` text NOT NULL,
	`token_hash` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "operation_invitations_role_check" CHECK("operation_invitations"."role" IN ('collaborator', 'viewer')),
	CONSTRAINT "operation_invitations_status_check" CHECK("operation_invitations"."status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_invitations_token_hash_unique` ON `operation_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `operation_invitations_target_user_status_idx` ON `operation_invitations` (`target_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `operation_invitations_operation_status_idx` ON `operation_invitations` (`operation_id`,`status`);--> statement-breakpoint
CREATE INDEX `operation_invitations_target_email_status_idx` ON `operation_invitations` (`target_email`,`status`);--> statement-breakpoint
CREATE TABLE `operation_members` (
	`operation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`operation_id`, `user_id`),
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operation_members_role_check" CHECK("operation_members"."role" IN ('collaborator', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `operation_members_user_role_idx` ON `operation_members` (`user_id`,`role`);--> statement-breakpoint
CREATE TABLE `operation_step_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`step_key` text NOT NULL,
	`reporter_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by_id` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operation_step_flags_status_check" CHECK("operation_step_flags"."status" IN ('open', 'resolved')),
	CONSTRAINT "operation_step_flags_version_check" CHECK("operation_step_flags"."version_number" >= 1)
);
--> statement-breakpoint
CREATE INDEX `operation_step_flags_op_status_created_idx` ON `operation_step_flags` (`operation_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_follows` (
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`follower_id`, `following_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_follows_no_self_follow_check" CHECK("user_follows"."follower_id" != "user_follows"."following_id")
);
--> statement-breakpoint
CREATE INDEX `user_follows_following_created_idx` ON `user_follows` (`following_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_follows_follower_created_idx` ON `user_follows` (`follower_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);--> statement-breakpoint
ALTER TABLE `operations` ADD `share_with_project` integer DEFAULT false NOT NULL;