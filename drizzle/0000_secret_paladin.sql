CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text,
	`severity` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_portfolio_unread` ON `alerts` (`portfolio_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`bucket` text NOT NULL,
	`target_weight` text NOT NULL,
	`minimum_weight` text,
	`maximum_weight` text,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_allocations_portfolio_bucket` ON `allocations` (`portfolio_id`,`bucket`);--> statement-breakpoint
CREATE TABLE `cash_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`event_type` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`related_entity_type` text,
	`related_entity_id` text,
	`description` text NOT NULL,
	`effective_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cash_ledger_idempotency` ON `cash_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_cash_ledger_portfolio_time` ON `cash_ledger` (`portfolio_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`commission` text DEFAULT '0' NOT NULL,
	`slippage` text DEFAULT '0' NOT NULL,
	`liquidity_model` text NOT NULL,
	`executed_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fills_portfolio_time` ON `fills` (`portfolio_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_fills_order` ON `fills` (`order_id`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`display_name` text NOT NULL,
	`asset_class` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exchange` text,
	`calendar_id` text,
	`multiplier` text DEFAULT '1' NOT NULL,
	`tick_size` text,
	`underlying_instrument_id` text,
	`expiration_at` text,
	`first_notice_at` text,
	`strike` text,
	`option_right` text,
	`exercise_style` text,
	`settlement_type` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_instruments_symbol_exchange` ON `instruments` (`symbol`,`exchange`);--> statement-breakpoint
CREATE INDEX `idx_instruments_underlying` ON `instruments` (`underlying_instrument_id`);--> statement-breakpoint
CREATE TABLE `order_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`ratio_quantity` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_legs_order` ON `order_legs` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`time_in_force` text NOT NULL,
	`status` text NOT NULL,
	`quantity` text NOT NULL,
	`filled_quantity` text DEFAULT '0' NOT NULL,
	`limit_price` text,
	`stop_price` text,
	`scheduled_for` text,
	`rejection_reason` text,
	`reconstruction_status` text DEFAULT 'observed' NOT NULL,
	`submitted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_orders_portfolio_status` ON `orders` (`portfolio_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_scheduled_for` ON `orders` (`scheduled_for`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`net_liquidation_value` text NOT NULL,
	`cash` text NOT NULL,
	`realized_pnl` text NOT NULL,
	`unrealized_pnl` text NOT NULL,
	`margin_requirement` text NOT NULL,
	`buying_power` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snapshots_portfolio_date` ON `portfolio_snapshots` (`portfolio_id`,`snapshot_date`);--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`starting_capital` text NOT NULL,
	`benchmark_symbol` text,
	`advanced_derivatives_enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`last_processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `position_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`opening_fill_id` text NOT NULL,
	`original_quantity` text NOT NULL,
	`remaining_quantity` text NOT NULL,
	`cost_basis` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opening_fill_id`) REFERENCES `fills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_position_lots_portfolio_instrument` ON `position_lots` (`portfolio_id`,`instrument_id`);--> statement-breakpoint
CREATE TABLE `processing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`event_type` text NOT NULL,
	`effective_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_processing_events_idempotency` ON `processing_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_processing_events_due` ON `processing_events` (`status`,`effective_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`provider` text NOT NULL,
	`bid` text,
	`ask` text,
	`last` text,
	`mark` text NOT NULL,
	`quality` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quotes_instrument_time` ON `quotes` (`instrument_id`,`observed_at`);--> statement-breakpoint
PRAGMA optimize;
