ALTER TABLE runs ADD COLUMN replay_source_run_id TEXT;
ALTER TABLE runs ADD COLUMN replay_from_step INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  assertion_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  max_steps INTEGER NOT NULL DEFAULT 30,
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed_cases INTEGER NOT NULL DEFAULT 0,
  failed_cases INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eval_case_runs (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  result_excerpt TEXT NOT NULL DEFAULT '',
  checks_json TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(eval_run_id) REFERENCES eval_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(suite_id) REFERENCES eval_suites(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES eval_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_suite_position ON eval_cases(suite_id, position);
CREATE INDEX IF NOT EXISTS idx_eval_runs_suite_created ON eval_runs(suite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_case_runs_eval_run ON eval_case_runs(eval_run_id, created_at ASC);
