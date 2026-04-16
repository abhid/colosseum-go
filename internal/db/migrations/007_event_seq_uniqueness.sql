DELETE FROM events
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM events
  GROUP BY run_id, seq
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_run_seq_unique ON events(run_id, seq);
