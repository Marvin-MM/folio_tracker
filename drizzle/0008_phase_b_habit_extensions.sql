ALTER TABLE `habits` ADD `energy_need` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `place` text DEFAULT 'anywhere' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `habit_logs` ADD `miss_reason` text;--> statement-breakpoint
ALTER TABLE `habit_logs` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Deterministic defaults for existing habits mirror defaultHabitMetadata():
-- low-energy words first, then high-energy words win on conflicts.
UPDATE `habits` SET `energy_need` = 'low' WHERE
	lower(`title`) LIKE '%journal%'
	OR lower(`title`) LIKE '%meditat%'
	OR lower(`title`) LIKE '%gratitude%'
	OR lower(`title`) LIKE '%pray%'
	OR lower(`title`) LIKE '%hydrate%'
	OR lower(`title`) LIKE '%sleep%'
	OR lower(`title`) LIKE '%wind down%'
	OR lower(`title`) LIKE '%read%';--> statement-breakpoint
UPDATE `habits` SET `energy_need` = 'high' WHERE
	lower(`title`) LIKE '%study%'
	OR lower(`title`) LIKE '%workout%'
	OR lower(`title`) LIKE '%run%'
	OR lower(`title`) LIKE '%push%up%'
	OR lower(`title`) LIKE '%gym%'
	OR lower(`title`) LIKE '%exercise%'
	OR lower(`title`) LIKE '%swim%';--> statement-breakpoint
-- Place precedence matches defaultHabitMetadata(): home, then work, then commute.
UPDATE `habits` SET `place` = 'home' WHERE
	lower(`title`) LIKE '%sleep%'
	OR lower(`title`) LIKE '%wake%'
	OR lower(`title`) LIKE '%hydrate%'
	OR lower(`title`) LIKE '%journal%'
	OR lower(`title`) LIKE '%meditat%'
	OR lower(`title`) LIKE '%gratitude%'
	OR lower(`title`) LIKE '%pray%'
	OR lower(`title`) LIKE '%push%up%';--> statement-breakpoint
UPDATE `habits` SET `place` = 'work' WHERE
	lower(`title`) LIKE '%work%'
	OR lower(`title`) LIKE '%study%'
	OR lower(`title`) LIKE '%office%';--> statement-breakpoint
UPDATE `habits` SET `place` = 'commute' WHERE
	lower(`title`) LIKE '%commute%'
	OR lower(`title`) LIKE '%travel%'
	OR lower(`title`) LIKE '%ride%';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `habit_saved_views` (
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
	CONSTRAINT `habit_saved_views_name_check` CHECK (length(`name`) BETWEEN 1 AND 48),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `habit_saved_views_user_name_uq` ON `habit_saved_views` (`user_id`,`name`) WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `habit_saved_views_user_deleted_idx` ON `habit_saved_views` (`user_id`,`deleted_at`);
