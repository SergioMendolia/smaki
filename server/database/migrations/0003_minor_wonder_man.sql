CREATE TABLE `file_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`page` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vision_descriptions` (
	`file_id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`pages` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `files` ADD `vision` integer;