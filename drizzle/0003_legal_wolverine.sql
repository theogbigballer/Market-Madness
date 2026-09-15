CREATE TABLE `performance_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`series_key` text NOT NULL,
	`value` text NOT NULL,
	`quality` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_performance_observations_bucket` ON `performance_observations` (`portfolio_id`,`series_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_performance_observations_portfolio_time` ON `performance_observations` (`portfolio_id`,`observed_at`);