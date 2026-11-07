ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE credit_ledger ADD COLUMN user_id INTEGER REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN user_id INTEGER REFERENCES users(id);
--> statement-breakpoint
CREATE TABLE credit_usage_new (
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);
--> statement-breakpoint
INSERT INTO credit_usage_new (user_id, category, used) SELECT 1, category, used FROM credit_usage;
--> statement-breakpoint
DROP TABLE credit_usage;
--> statement-breakpoint
ALTER TABLE credit_usage_new RENAME TO credit_usage;
