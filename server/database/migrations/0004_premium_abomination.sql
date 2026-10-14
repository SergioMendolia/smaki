ALTER TABLE `users` ADD `username` text;
--> statement-breakpoint
UPDATE `users` SET `username` = lower(substr(`email`, 1, instr(`email`, '@') - 1));