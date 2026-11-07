ALTER TABLE `projects` ADD COLUMN `planner_md` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_chat_messages` ADD COLUMN `kind` text DEFAULT 'build' NOT NULL;
