export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  github TEXT,
  org_url TEXT,
  nonprofit INTEGER NOT NULL DEFAULT 0,
  repo_path TEXT NOT NULL,
  agents_md TEXT,
  registered_at INTEGER NOT NULL,
  checks_json TEXT,
  cause TEXT,
  summary TEXT,
  preview_url TEXT,
  volunteer_reviewers INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  local_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  instructions TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  tests TEXT NOT NULL,
  scope_do TEXT NOT NULL,
  scope_dont TEXT NOT NULL,
  deliverable TEXT NOT NULL,
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
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
  safety_status TEXT NOT NULL CHECK (safety_status IN ('clear', 'flagged', 'approved')) DEFAULT 'clear',
  safety_flags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'code',
  needs_computer INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  revision_pr TEXT,
  revision_donor TEXT,
  revision_until INTEGER,
  revision_feedback TEXT,
  issue_number INTEGER,
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
  created_at INTEGER NOT NULL,
  handle TEXT NOT NULL,
  account_id TEXT
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
  revoked_at INTEGER,
  label TEXT,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES donors(id),
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  task_count INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'stopped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  has_computer INTEGER NOT NULL DEFAULT 1
);

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

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  org_name TEXT NOT NULL,
  website TEXT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT,
  status_kind TEXT NOT NULL,
  github TEXT NOT NULL,
  repo_url TEXT,
  needs TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  onboarder_account_id TEXT,
  onboarder_note TEXT,
  listing_url TEXT
);

CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'money')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, kind)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);


CREATE TABLE IF NOT EXISTS workspaces (
  task_id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_files (
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, path)
);

CREATE TABLE IF NOT EXISTS check_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  donor_id TEXT NOT NULL,
  workspace_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'error')),
  exit_code INTEGER,
  output TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_check_runs_task ON check_runs(task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks (state, created_at, id);
CREATE INDEX IF NOT EXISTS idx_sessions_donor ON work_sessions (donor_id, status);
CREATE INDEX IF NOT EXISTS idx_deps_parent ON task_dependencies (depends_on_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE,
  github_login TEXT,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  reviewer_status TEXT,
  onboarder_status TEXT
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

CREATE INDEX IF NOT EXISTS donors_account ON donors(account_id);

CREATE TABLE IF NOT EXISTS task_plans (
  task_id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL,
  plan_json TEXT,
  evidence_json TEXT,
  check_status TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_signals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_signals_task ON task_signals(task_id, created_at);

CREATE TABLE IF NOT EXISTS task_outcomes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  donor_id TEXT,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_outcomes_task ON task_outcomes(task_id, created_at);
CREATE INDEX IF NOT EXISTS task_outcomes_donor ON task_outcomes(donor_id, created_at);

CREATE TABLE IF NOT EXISTS sync_notes (
  project_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  message TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, ref)
);
`
