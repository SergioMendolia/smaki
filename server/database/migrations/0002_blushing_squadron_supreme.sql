ALTER TABLE `files` ADD `indexed_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `files` SET `indexed_at` = `created_at` WHERE `indexed_at` = 0;