CREATE TABLE `cloudflare_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `account_id` text DEFAULT '' NOT NULL,
  `zone_id` text DEFAULT '' NOT NULL,
  `token_ciphertext` text DEFAULT '' NOT NULL,
  `token_hint` text DEFAULT '' NOT NULL,
  `server_ip` text DEFAULT '82.25.62.243' NOT NULL,
  `record_mode` text DEFAULT 'dns_only' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `cloudflare_record_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `dns_status` text DEFAULT '' NOT NULL;
