CREATE TABLE `market_data_credentials` (
	`session_hash` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`iv` text NOT NULL,
	`key_id_masked` text NOT NULL,
	`connected_at` text NOT NULL,
	`validated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_market_data_credentials_session_provider` ON `market_data_credentials` (`session_hash`,`provider`);