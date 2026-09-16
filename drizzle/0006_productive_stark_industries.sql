CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`symbol` text,
	`asset_class` text,
	`comparator` text NOT NULL,
	`threshold` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_value` text,
	`triggered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alert_rules_portfolio_status` ON `alert_rules` (`portfolio_id`,`status`);