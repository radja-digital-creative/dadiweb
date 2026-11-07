CREATE TABLE `google_oauth_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `client_id` text DEFAULT '' NOT NULL,
  `secret_ciphertext` text DEFAULT '' NOT NULL,
  `secret_hint` text DEFAULT '' NOT NULL,
  `redirect_uri` text DEFAULT '' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_oauth_states` (
  `state` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `google_sub` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);
