ALTER TABLE `orders` ADD `client_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_portfolio_request` ON `orders` (`portfolio_id`,`client_request_id`);