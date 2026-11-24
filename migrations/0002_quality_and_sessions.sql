ALTER TABLE tasks ADD COLUMN goal TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN tests TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN scope_do TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN scope_dont TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN deliverable TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN size TEXT NOT NULL DEFAULT 'small';

ALTER TABLE donors ADD COLUMN handle TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES donors(id),
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  task_count INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'stopped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_donor ON work_sessions (donor_id, status);
