# Configuration

`colosseum` configuration is provided via environment variables and CLI flags.

Precedence:

1. Explicit flags
2. Environment variables
3. Built-in defaults

## Server Flags

- `--bind`  
  Full bind address (`ip:port`). If set, it overrides `--listen-ip` and `--port`.
- `--listen-ip`  
  Listen host/IP.
- `--port`  
  Listen port.
- `--db`  
  SQLite database path.
- `--artifacts`  
  Artifact root directory.
- `--workspace-root`  
  Managed run workspace root directory.
- `--model`  
  Default model fallback.

## Environment Variables

- `COLOSSEUM_BIND`
- `COLOSSEUM_LISTEN_IP`
- `COLOSSEUM_PORT`
- `COLOSSEUM_DB_PATH`
- `COLOSSEUM_ARTIFACT_PATH`
- `COLOSSEUM_WORKSPACE_ROOT`
- `COLOSSEUM_DOCKER_IMAGE`
- `COLOSSEUM_DEFAULT_MODEL`
- `COLOSSEUM_BROWSER_MODE` (`docker`, `local`, `auto`)
- `COLOSSEUM_BROWSER_IMAGE` (Playwright image used for docker browser backend)
- `COLOSSEUM_BROWSER_FALLBACK` (`true`/`false`)
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DOCKER_HOST` (if non-default docker host is required)

## Recommended Local Config

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...

./bin/colosseum server \
  --listen-ip 127.0.0.1 \
  --port 8080 \
  --db ./colosseum.db \
  --artifacts ./artifacts \
  --workspace-root ./workspaces
```

## Workspace Management

On run creation:

- If `workspace_path` is omitted, `colosseum` creates one under `workspace-root/<run_id>`.
- If `source_workspace_path` is provided, contents are copied into the run workspace.

## Docker Runtime Defaults

- Docker image default is configured via `COLOSSEUM_DOCKER_IMAGE`.
- Workspace mount target is `/workspace`.
- Tool commands execute inside that mounted workspace.

## Operational Notes

- Ensure the process user can read/write:
  - DB path
  - artifact directory
  - workspace root
- Ensure docker CLI/daemon access for sandboxed tool execution.

