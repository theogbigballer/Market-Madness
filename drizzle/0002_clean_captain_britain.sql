CREATE TABLE `corporate_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`symbol` text NOT NULL,
	`action_type` text NOT NULL,
	`effective_at` text NOT NULL,
	`ratio` text,
	`cash_amount` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`source` text DEFAULT 'manual_simulation' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_corporate_actions_due` ON `corporate_actions` (`status`,`effective_at`);--> statement-breakpoint
CREATE INDEX `idx_corporate_actions_instrument` ON `corporate_actions` (`instrument_id`);