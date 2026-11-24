-- People sign in to the website with GitHub or an emailed link. A volunteer
-- name (donor) belongs to one account; connection keys get a label each.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE,
  github_login TEXT,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions(account_id);

CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  return_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS signin_app (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  client_secret_sealed TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The volunteer's stated plan and evidence for the task they hold.
CREATE TABLE IF NOT EXISTS task_plans (
  task_id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL,
  plan_json TEXT,
  evidence_json TEXT,
  check_status TEXT,
  updated_at INTEGER NOT NULL
);

-- What GitHub reports about a volunteer pull request: reviews and CI results.
CREATE TABLE IF NOT EXISTS task_signals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_signals_task ON task_signals(task_id, created_at);

ALTER TABLE donors ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS donors_account ON donors(account_id);

ALTER TABLE mcp_tokens ADD COLUMN label TEXT;
ALTER TABLE mcp_tokens ADD COLUMN last_used_at INTEGER;

-- Tasks that need the volunteer's own computer are not offered to chat apps.
ALTER TABLE tasks ADD COLUMN needs_computer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN has_computer INTEGER NOT NULL DEFAULT 1;
