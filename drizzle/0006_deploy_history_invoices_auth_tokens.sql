ALTER TABLE `deployments` ADD COLUMN `kind` text DEFAULT 'deploy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer REFERENCES users(id),
	`ledger_id` integer REFERENCES credit_ledger(id),
	`number` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'topup' NOT NULL,
	`title` text NOT NULL,
	`amount_idr` integer,
	`credits_delta` integer DEFAULT 0 NOT NULL,
	`balance_after` integer,
	`status` text DEFAULT 'paid' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL REFERENCES users(id),
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `simulated_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer REFERENCES users(id),
	`email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`token` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
