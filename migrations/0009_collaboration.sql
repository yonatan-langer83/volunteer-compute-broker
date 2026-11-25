-- Working together: revisions on the same pull request, tasks from GitHub
-- issues, preview links, and volunteer reviewers.
ALTER TABLE tasks ADD COLUMN revision_pr TEXT;
ALTER TABLE tasks ADD COLUMN revision_donor TEXT;
ALTER TABLE tasks ADD COLUMN revision_until INTEGER;
ALTER TABLE tasks ADD COLUMN revision_feedback TEXT;
ALTER TABLE tasks ADD COLUMN issue_number INTEGER;
ALTER TABLE projects ADD COLUMN preview_url TEXT;
ALTER TABLE projects ADD COLUMN volunteer_reviewers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN reviewer_status TEXT;

-- Problems found while reading a project's tasks (e.g. an incomplete task issue),
-- shown to the organization on its account page.
CREATE TABLE IF NOT EXISTS sync_notes (
  project_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  message TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, ref)
);
