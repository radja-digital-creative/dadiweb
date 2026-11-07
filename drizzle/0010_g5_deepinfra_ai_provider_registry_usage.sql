CREATE TABLE `ai_stage_models` (
	`stage` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'deepinfra' NOT NULL,
	`primary_model` text NOT NULL,
	`fallback_model` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`input_price_usd` real DEFAULT 0 NOT NULL,
	`output_price_usd` real DEFAULT 0 NOT NULL,
	`fallback_input_price_usd` real DEFAULT 0 NOT NULL,
	`fallback_output_price_usd` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'deepinfra' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`project_id` integer,
	`user_id` integer,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'sukses' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_provider_secrets` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text DEFAULT '' NOT NULL,
	`hint` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
