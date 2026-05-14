# Deployment Notes

Colosseum is designed as a single-node operator control plane. Treat it as privileged infrastructure because it can execute tools, store secrets, and expose run transcripts.

## Minimum Production Checklist

- Bind intentionally. Use `COLOSSEUM_LISTEN_IP=127.0.0.1` behind a reverse proxy, or set `COLOSSEUM_API_AUTH_TOKEN` before binding to a shared interface.
- Set `COLOSSEUM_SECRET_KEY` before creating secrets or credential vault bindings. Back this key up with the database.
- Store `COLOSSEUM_DB_PATH`, `COLOSSEUM_ARTIFACT_PATH`, and `COLOSSEUM_WORKSPACE_ROOT` on persistent storage with restrictive permissions.
- Run the process as a least-privilege OS user.
- Restrict Docker daemon access and egress network paths for tool execution.
- Pin `COLOSSEUM_BROWSER_IMAGE` to a known-good Playwright image.

## Build

```bash
npm --prefix ui ci
make build
```

`make build` compiles the UI and embeds it into the Go binary.

## Backup And Restore

Back up these together:

- SQLite database file and any `*.db-wal` / `*.db-shm` companions
- artifact directory
- workspace root, if active runs or generated files must be preserved
- `COLOSSEUM_SECRET_KEY`

Restore them as a consistent set. A database restored without matching artifacts or workspaces can still show run metadata, but artifact downloads and replay context may be incomplete.

## Current Packaging Status

This repository does not yet include a Dockerfile, compose file, systemd unit, or managed release package. Until those exist, deploy the built binary with explicit environment configuration and host-level process supervision.
