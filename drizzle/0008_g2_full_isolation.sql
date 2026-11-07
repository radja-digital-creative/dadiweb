ALTER TABLE `project_tables` ADD COLUMN `schema_name` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `project_tables` SET `schema_name` = 'proj_' || `project_id` WHERE `schema_name` = '';
--> statement-breakpoint
CREATE TABLE `project_db_credentials` (
  `project_id` INTEGER PRIMARY KEY,
  `schema_name` TEXT NOT NULL DEFAULT '',
  `db_username` TEXT NOT NULL DEFAULT '',
  `password_hint` TEXT NOT NULL DEFAULT '',
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_secrets` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `project_id` INTEGER NOT NULL REFERENCES `projects`(`id`),
  `name` TEXT NOT NULL,
  `ciphertext` TEXT NOT NULL DEFAULT '',
  `hint` TEXT NOT NULL DEFAULT '',
  `key_version` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `secret_events` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `project_id` INTEGER NOT NULL REFERENCES `projects`(`id`),
  `secret_name` TEXT NOT NULL DEFAULT '',
  `event` TEXT NOT NULL DEFAULT 'create',
  `detail` TEXT NOT NULL DEFAULT '',
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executor_jobs` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `project_id` INTEGER NOT NULL REFERENCES `projects`(`id`),
  `user_id` INTEGER REFERENCES `users`(`id`),
  `kind` TEXT NOT NULL DEFAULT 'build',
  `sandbox_dir` TEXT NOT NULL DEFAULT '',
  `status` TEXT NOT NULL DEFAULT 'running',
  `detail` TEXT NOT NULL DEFAULT '',
  `network_policy` TEXT NOT NULL DEFAULT '',
  `time_limit_sec` INTEGER NOT NULL DEFAULT 120,
  `memory_limit_mb` INTEGER NOT NULL DEFAULT 512,
  `artifact_path` TEXT NOT NULL DEFAULT '',
  `copied_back` INTEGER NOT NULL DEFAULT 0,
  `workspace_deleted` INTEGER NOT NULL DEFAULT 0,
  `created_at` INTEGER NOT NULL,
  `finished_at` INTEGER
);
--> statement-breakpoint
CREATE TABLE `project_uploads` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `project_id` INTEGER NOT NULL REFERENCES `projects`(`id`),
  `file_name` TEXT NOT NULL DEFAULT '',
  `mime_type` TEXT NOT NULL DEFAULT '',
  `size_bytes` INTEGER NOT NULL DEFAULT 0,
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_deletion_log` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `user_id` INTEGER REFERENCES `users`(`id`),
  `project_id` INTEGER NOT NULL,
  `project_name` TEXT NOT NULL DEFAULT '',
  `schema_name` TEXT NOT NULL DEFAULT '',
  `detail` TEXT NOT NULL DEFAULT '',
  `created_at` INTEGER NOT NULL
);
