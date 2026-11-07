CREATE TABLE `skill_catalog_state` (
  `skill_name` TEXT PRIMARY KEY,
  `is_active` INTEGER NOT NULL DEFAULT 1,
  `eval_score` REAL,
  `updated_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_status_log` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `skill_name` TEXT NOT NULL DEFAULT '',
  `action` TEXT NOT NULL DEFAULT '',
  `detail` TEXT NOT NULL DEFAULT '',
  `actor_user_id` INTEGER REFERENCES `users`(`id`),
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_candidates` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `prompt` TEXT NOT NULL DEFAULT '',
  `nearest_skill` TEXT,
  `nearest_score` INTEGER NOT NULL DEFAULT 0,
  `user_id` INTEGER REFERENCES `users`(`id`),
  `created_at` INTEGER NOT NULL
);
