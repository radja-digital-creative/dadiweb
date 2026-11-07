ALTER TABLE `projects` ADD COLUMN `skill_plan` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `skill_versions` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL REFERENCES projects(id),
	`path` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `path_violations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer REFERENCES users(id),
	`project_id` integer,
	`path` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
