ALTER TABLE `users` ADD COLUMN `is_active` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `community_posts` ADD COLUMN `is_hidden` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_id` integer,
	`admin_email` text DEFAULT '' NOT NULL,
	`action` text DEFAULT '' NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`before_value` text DEFAULT '' NOT NULL,
	`after_value` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`platform_name` text DEFAULT 'Dadiweb' NOT NULL,
	`maintenance_message` text DEFAULT '' NOT NULL,
	`maintenance_enabled` integer DEFAULT false NOT NULL,
	`free_quota` integer DEFAULT 200 NOT NULL,
	`generate_cost` integer DEFAULT 300 NOT NULL,
	`deploy_cost` integer DEFAULT 25 NOT NULL,
	`android_cost` integer DEFAULT 150 NOT NULL,
	`updated_at` integer NOT NULL
);
