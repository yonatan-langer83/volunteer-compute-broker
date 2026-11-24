-- The project directory: what each organization works on, in one sentence.
ALTER TABLE projects ADD COLUMN cause TEXT;
ALTER TABLE projects ADD COLUMN summary TEXT;

-- Every way a task attempt ends, for the routines in the handbook:
-- a task handed back three times is paused for a better brief, and a
-- volunteer whose work is often turned down goes back to small tasks.
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

ALTER TABLE tasks ADD COLUMN paused_reason TEXT;
