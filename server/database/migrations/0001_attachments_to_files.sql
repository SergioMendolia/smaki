DROP TABLE IF EXISTS `attachments`;--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`dir` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`extracted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);