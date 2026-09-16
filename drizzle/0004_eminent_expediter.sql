CREATE TABLE `lot_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`opening_lot_id` text NOT NULL,
	`closing_fill_id` text,
	`quantity` text NOT NULL,
	`entry_price` text NOT NULL,
	`exit_price` text NOT NULL,
	`multiplier` text NOT NULL,
	`realized_pnl` text NOT NULL,
	`closure_reason` text NOT NULL,
	`basis_transferred` integer DEFAULT false NOT NULL,
	`closed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opening_lot_id`) REFERENCES `position_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closing_fill_id`) REFERENCES `fills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lot_closures_portfolio_time` ON `lot_closures` (`portfolio_id`,`closed_at`);--> statement-breakpoint
CREATE INDEX `idx_lot_closures_portfolio_instrument` ON `lot_closures` (`portfolio_id`,`instrument_id`);