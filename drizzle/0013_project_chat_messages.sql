CREATE TABLE `project_chat_messages` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `project_id` INTEGER NOT NULL REFERENCES `projects` (`id`),
  `user_id` INTEGER REFERENCES `users` (`id`),
  `role` TEXT NOT NULL CHECK (`role` IN ('user', 'assistant')),
  `content` TEXT NOT NULL DEFAULT '',
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_chat_messages_project_id_idx` ON `project_chat_messages` (`project_id`);
