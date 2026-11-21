PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`note_id` text,
	`remind_at` integer NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`dispatched_at` integer,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_target_xor_check" CHECK((("__new_reminders"."task_id" IS NOT NULL AND "__new_reminders"."note_id" IS NULL) OR ("__new_reminders"."task_id" IS NULL AND "__new_reminders"."note_id" IS NOT NULL))),
	CONSTRAINT "reminders_status_check" CHECK("__new_reminders"."status" IN ('pending_far', 'scheduled', 'sent', 'snoozed', 'cancelled')),
	CONSTRAINT "reminders_version_check" CHECK("__new_reminders"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "user_id", "task_id", "note_id", "remind_at", "timezone", "status", "version", "dispatched_at", "sent_at", "created_at", "updated_at") SELECT "id", "user_id", CASE WHEN "entity_type" = 'task' THEN "entity_id" ELSE NULL END, CASE WHEN "entity_type" = 'note' THEN "entity_id" ELSE NULL END, "remind_at", "timezone", "status", "version", CASE WHEN "status" IN ('scheduled', 'sent') THEN "updated_at" ELSE NULL END, "sent_at", "created_at", "updated_at" FROM `reminders` WHERE ("entity_type" = 'task' AND "entity_id" IN (SELECT "id" FROM `tasks`)) OR ("entity_type" = 'note' AND "entity_id" IN (SELECT "id" FROM `notes`));--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reminders_status_remind_at_idx` ON `reminders` (`status`,`remind_at`);--> statement-breakpoint
CREATE INDEX `reminders_outbox_idx` ON `reminders` (`status`,`dispatched_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `reminders_task_id_idx` ON `reminders` (`task_id`);--> statement-breakpoint
CREATE INDEX `reminders_note_id_idx` ON `reminders` (`note_id`);--> statement-breakpoint
CREATE INDEX `reminders_user_status_remind_at_idx` ON `reminders` (`user_id`,`status`,`remind_at`);