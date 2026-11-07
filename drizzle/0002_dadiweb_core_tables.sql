DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Website',
  status TEXT NOT NULL DEFAULT 'draft',
  prompt TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'ai',
  credits_cost INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  credits INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE credit_account (
  id INTEGER PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'Pro Plan',
  monthly_quota INTEGER NOT NULL DEFAULT 5000,
  balance INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'generate',
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'AI Coding',
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE credit_usage (
  category TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL DEFAULT 230,
  uses INTEGER NOT NULL DEFAULT 0,
  spec TEXT NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE project_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE project_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES project_tables(id),
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  subdomain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Budi Santoso',
  email TEXT NOT NULL DEFAULT 'budi@email.com',
  plan TEXT NOT NULL DEFAULT 'Pro Plan',
  price_idr REAL NOT NULL DEFAULT 299000
);
--> statement-breakpoint
CREATE TABLE integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0
);
