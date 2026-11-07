-- G13-A — Video Dadiweb (fal.ai): settings kunci + parameter rumus tarif
-- dan registry model video. Idempotent: CREATE TABLE IF NOT EXISTS dan
-- INSERT ... ON CONFLICT DO NOTHING, jadi migrasi ini aman dijalankan 2x.
CREATE TABLE IF NOT EXISTS `fal_video_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `fal_key_encrypted` text DEFAULT '' NOT NULL,
  `fal_key_hint` text DEFAULT '' NOT NULL,
  `credit_value_rp` integer DEFAULT 54 NOT NULL,
  `markup_x100` integer DEFAULT 150 NOT NULL,
  `exchange_rate_rp_per_usd` integer DEFAULT 16500 NOT NULL,
  `rounding_step` integer DEFAULT 5 NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `video_models` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,
  `label` text NOT NULL,
  `endpoint_t2v` text NOT NULL,
  `endpoint_i2v` text NOT NULL,
  `min_duration` integer NOT NULL,
  `max_duration` integer NOT NULL,
  `resolutions` text NOT NULL,
  `is_active` integer DEFAULT true NOT NULL,
  `is_default` integer DEFAULT false NOT NULL,
  CONSTRAINT `video_models_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
INSERT INTO `fal_video_settings` (`id`, `fal_key_encrypted`, `fal_key_hint`, `credit_value_rp`, `markup_x100`, `exchange_rate_rp_per_usd`, `rounding_step`, `updated_at`) VALUES (1, '', '', 54, 150, 16500, 5, unixepoch() * 1000) ON CONFLICT(`id`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `video_models` (`key`, `label`, `endpoint_t2v`, `endpoint_i2v`, `min_duration`, `max_duration`, `resolutions`, `is_active`, `is_default`) VALUES ('wan-3.0', 'Wan 3.0', 'alibaba/wan-3.0/text-to-video', 'alibaba/wan-3.0/image-to-video', 2, 30, '[{"resolution":"480p","pricePerSecUsd":0.05},{"resolution":"720p","pricePerSecUsd":0.1},{"resolution":"1080p","pricePerSecUsd":0.2}]', 1, 1) ON CONFLICT(`key`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `video_models` (`key`, `label`, `endpoint_t2v`, `endpoint_i2v`, `min_duration`, `max_duration`, `resolutions`, `is_active`, `is_default`) VALUES ('kling-4.0', 'Kling 4.0', 'kling/v4/text-to-video', 'kling/v4/image-to-video', 3, 30, '[{"resolution":"720p","pricePerSecUsd":0.157},{"resolution":"1080p","pricePerSecUsd":0.235}]', 1, 0) ON CONFLICT(`key`) DO NOTHING;
