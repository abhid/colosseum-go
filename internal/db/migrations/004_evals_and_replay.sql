ALTER TABLE runs ADD COLUMN replay_source_run_id TEXT;
ALTER TABLE runs ADD COLUMN replay_from_step INTEGER NOT NULL DEFAULT 1;
