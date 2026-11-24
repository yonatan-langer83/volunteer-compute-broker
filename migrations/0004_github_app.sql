CREATE TABLE IF NOT EXISTS github_app (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  private_key_sealed TEXT NOT NULL,
  webhook_secret_sealed TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS setup_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
