ALTER TABLE `portfolios` ADD `owner_user_id` text DEFAULT 'local-user' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_portfolios_owner_status` ON `portfolios` (`owner_user_id`,`status`);