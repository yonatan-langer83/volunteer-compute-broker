ALTER TABLE projects ADD COLUMN checks_json TEXT;
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'code';

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
