ALTER TABLE integrations ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE custom_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verification_token TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  ssl_status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE android_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  app_name TEXT NOT NULL,
  package_id TEXT NOT NULL,
  version_name TEXT NOT NULL DEFAULT '1.0.0',
  version_code INTEGER NOT NULL DEFAULT 1,
  build_type TEXT NOT NULL DEFAULT 'apk',
  status TEXT NOT NULL DEFAULT 'ready',
  icon_color TEXT NOT NULL DEFAULT '#2E6BFF',
  splash_text TEXT NOT NULL DEFAULT '',
  credits_cost INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT 'Diskusi',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE community_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES community_posts(id),
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE community_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES community_posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id)
);
