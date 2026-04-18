PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  starter_prompts TEXT NOT NULL DEFAULT '[]',
  default_task TEXT NOT NULL DEFAULT '',
  default_max_steps INTEGER NOT NULL DEFAULT 30,
  default_workspace_path TEXT NOT NULL DEFAULT '',
  default_environment_id TEXT NOT NULL DEFAULT '',
  default_credential_vault_id TEXT NOT NULL DEFAULT '',
  output_contract_type TEXT NOT NULL DEFAULT 'none',
  output_contract_payload TEXT NOT NULL DEFAULT '',
  planning_mode TEXT NOT NULL DEFAULT 'off',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  max_steps INTEGER NOT NULL DEFAULT 30,
  environment_id TEXT NOT NULL DEFAULT '',
  credential_vault_id TEXT NOT NULL DEFAULT '',
  output_contract_type TEXT NOT NULL DEFAULT 'none',
  output_contract_payload TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(agent_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);

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

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL DEFAULT 'v1',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_class TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  logs_path TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(step_id) REFERENCES run_steps(id)
);

CREATE TABLE IF NOT EXISTS trace_spans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  attrs_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  docker_container_id TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'policy',
  details TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  plan_step_id TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

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

CREATE TABLE IF NOT EXISTS session_plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_plans_session ON session_plans(session_id);

CREATE TABLE IF NOT EXISTS session_plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  blocker TEXT NOT NULL DEFAULT '',
  owner_run_id TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(plan_id) REFERENCES session_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_plan_steps_plan_idx ON session_plan_steps(plan_id, idx);
CREATE INDEX IF NOT EXISTS idx_session_plan_steps_status ON session_plan_steps(plan_id, status);

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

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_vaults (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_vault_items (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(vault_id, secret_name),
  FOREIGN KEY(vault_id) REFERENCES credential_vaults(id) ON DELETE CASCADE,
  FOREIGN KEY(secret_name) REFERENCES secrets(name) ON DELETE CASCADE
);

