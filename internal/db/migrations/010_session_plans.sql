-- Session-scoped planning artifacts. Scaffolded self-planning: the model
-- authors plan content via plan.* tools; the harness persists it, surfaces it
-- in the session primer, and exposes it to the UI for handoff/audit.

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
  status TEXT NOT NULL,               -- pending|in_progress|completed|skipped|blocked
  blocker TEXT NOT NULL DEFAULT '',
  owner_run_id TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(plan_id) REFERENCES session_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_plan_steps_plan_idx ON session_plan_steps(plan_id, idx);
CREATE INDEX IF NOT EXISTS idx_session_plan_steps_status ON session_plan_steps(plan_id, status);

-- Per-agent planning mode: off|suggest|required. Default 'off' ensures zero
-- behavior change for every existing agent.
ALTER TABLE agents ADD COLUMN planning_mode TEXT NOT NULL DEFAULT 'off';

-- Approvals can optionally reference the plan step that triggered them. Enables
-- audit views like "approval requested during step 5 of 8".
ALTER TABLE approvals ADD COLUMN plan_step_id TEXT NOT NULL DEFAULT '';
