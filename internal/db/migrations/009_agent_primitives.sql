-- parent/child run lineage for subagent.spawn
ALTER TABLE runs ADD COLUMN parent_run_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);

-- session-scoped scratchpad
CREATE TABLE IF NOT EXISTS session_scratchpad (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, key),
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scratchpad_session_updated ON session_scratchpad(session_id, updated_at DESC);

-- background processes launched via process.run_background
CREATE TABLE IF NOT EXISTS run_processes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  pid INTEGER NOT NULL,
  command TEXT NOT NULL,
  log_path TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_processes_run ON run_processes(run_id);

-- approvals: track who requested (policy vs. model.tool) and long-form details
ALTER TABLE approvals ADD COLUMN source TEXT NOT NULL DEFAULT 'policy';
ALTER TABLE approvals ADD COLUMN details TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN risk TEXT NOT NULL DEFAULT '';
