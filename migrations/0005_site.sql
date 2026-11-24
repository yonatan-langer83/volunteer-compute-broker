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
  state TEXT NOT NULL DEFAULT 'new'
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

CREATE INDEX IF NOT EXISTS idx_donors_handle ON donors(handle);
