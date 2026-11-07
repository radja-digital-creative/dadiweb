-- G13-B — Job video Dadiweb (fal.ai): satu baris per submit video ke
-- fal.ai (T2V/I2V), status queue, URL fal.ai (jejak sementara) + path
-- blob lokal hasil unduhan MP4. Idempotent: CREATE TABLE IF NOT EXISTS
-- dan CREATE INDEX IF NOT EXISTS, jadi migrasi ini aman dijalankan 2x.
CREATE TABLE IF NOT EXISTS `video_jobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES projects(id),
  `user_id` integer REFERENCES users(id),
  `model_key` text NOT NULL,
  `endpoint` text NOT NULL,
  `prompt` text DEFAULT '' NOT NULL,
  `image_url` text,
  `duration` integer NOT NULL,
  `resolution` text NOT NULL,
  `credits_cost` integer DEFAULT 0 NOT NULL,
  `fal_request_id` text,
  `status` text DEFAULT 'submitted' NOT NULL,
  `status_url` text,
  `response_url` text,
  `cancel_url` text,
  `video_url` text,
  `local_path` text,
  `error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  CONSTRAINT `video_jobs_fal_request_id_unique` UNIQUE(`fal_request_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `video_jobs_project_id_idx` ON `video_jobs` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `video_jobs_fal_request_id_idx` ON `video_jobs` (`fal_request_id`);
