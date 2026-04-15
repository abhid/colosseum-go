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

ALTER TABLE agents ADD COLUMN default_environment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN default_credential_vault_id TEXT NOT NULL DEFAULT '';

ALTER TABLE runs ADD COLUMN environment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN credential_vault_id TEXT NOT NULL DEFAULT '';
