CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  github TEXT,
  org_url TEXT,
  nonprofit INTEGER NOT NULL DEFAULT 0,
  repo_path TEXT NOT NULL,
  agents_md TEXT,
  registered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  local_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  provider_override TEXT,
  estimated_cost_usd REAL NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('blocked', 'open', 'claimed', 'running', 'review', 'done', 'failed')),
  donor_id TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  failure_reason TEXT,
  reserved_cost_usd REAL NOT NULL DEFAULT 0,
  budget_period TEXT,
  submission_summary TEXT,
  submission_url TEXT,
  submission_patch TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, local_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS donors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('key', 'mcp')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'xai', 'google')),
  spending_cap_usd REAL NOT NULL,
  spent_usd REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  monthly_task_budget INTEGER,
  spent_tasks INTEGER NOT NULL DEFAULT 0,
  reserved_tasks INTEGER NOT NULL DEFAULT 0,
  budget_period TEXT NOT NULL,
  terms_accepted_at INTEGER NOT NULL,
  key_validated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  donor_id TEXT PRIMARY KEY REFERENCES donors(id),
  envelope_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS donor_support (
  donor_id TEXT NOT NULL REFERENCES donors(id),
  project_name TEXT NOT NULL,
  PRIMARY KEY (donor_id, project_name)
);

CREATE TABLE IF NOT EXISTS donor_periods (
  donor_id TEXT NOT NULL REFERENCES donors(id),
  period TEXT NOT NULL,
  spent_usd REAL NOT NULL,
  reserved_usd REAL NOT NULL,
  spent_tasks INTEGER NOT NULL DEFAULT 0,
  reserved_tasks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (donor_id, period)
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES donors(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks (state, created_at, id);
CREATE INDEX IF NOT EXISTS idx_deps_parent ON task_dependencies (depends_on_id);
