ALTER TABLE agents ADD COLUMN output_contract_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE agents ADD COLUMN output_contract_payload TEXT NOT NULL DEFAULT '';

ALTER TABLE runs ADD COLUMN output_contract_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE runs ADD COLUMN output_contract_payload TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  pinned_at TEXT,
  FOREIGN KEY(agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  run_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_runs (
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_id, run_id),
  UNIQUE(session_id, turn_index),
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_turn_created ON chat_messages(session_id, turn_index, created_at);
CREATE INDEX IF NOT EXISTS idx_session_runs_session_turn ON session_runs(session_id, turn_index);
