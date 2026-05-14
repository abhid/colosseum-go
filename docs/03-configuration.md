# Configuration

`colosseum` reads configuration from CLI flags, environment variables, and optional `.env` files.

Precedence:

1. CLI flags
2. shell environment variables
3. `.env.local`, then `.env`
4. built-in defaults

## CLI Flags

- `--bind` full bind address (`ip:port`)
- `--listen-ip` listen IP/host
- `--port` listen port
- `--db` SQLite path
- `--artifacts` artifact root path
- `--workspace-root` managed workspace root
- `--model` default model fallback

## Environment Variables

### Server Core

- `COLOSSEUM_BIND`
- `COLOSSEUM_LISTEN_IP` (default: `0.0.0.0`)
- `COLOSSEUM_PORT`
- `COLOSSEUM_DB_PATH` (default: `./colosseum.db`)
- `COLOSSEUM_ARTIFACT_PATH` (default: `./artifacts`)
- `COLOSSEUM_WORKSPACE_ROOT` (default: `./workspaces`)
- `COLOSSEUM_API_AUTH_TOKEN` (recommended for any non-local deployment)
- `COLOSSEUM_SECRET_KEY` (required before storing secrets)
- `COLOSSEUM_DEFAULT_MODEL`
- `COLOSSEUM_DOCKER_IMAGE` (tool/docker execution image for applicable workloads)
- `DOCKER_HOST` (optional custom docker daemon)

### Browser Runtime

- `COLOSSEUM_BROWSER_MODE` (`docker` or `local`)
- `COLOSSEUM_BROWSER_IMAGE` (default: `mcr.microsoft.com/playwright:v1.59.1-jammy`)
- `COLOSSEUM_BROWSER_FALLBACK` (`true`/`false`)
- `COLOSSEUM_PLAYWRIGHT_NODE_PATH` (optional explicit local `node_modules` path for playwright resolution)

### Providers

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Provider visibility in UI is dynamic: providers are shown only when corresponding credentials are configured.

## Recommended Local Command

```bash
OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
./bin/colosseum server \
  --port 8080 \
  --db ./colosseum.db \
  --artifacts ./artifacts \
  --workspace-root ./workspaces
```

## Workspace Behavior

For normal run creation, workspace paths are auto-managed. `colosseum` creates run workspaces under `workspace-root/<run_id>`.

The API still supports optional explicit workspace fields for advanced integrations, but the operator UI defaults to auto-managed workspaces.

## Browser Version Matching

When `COLOSSEUM_BROWSER_MODE=docker`, the runtime validates that:

- local Playwright package version
- Playwright docker image tag version

are compatible. Mismatch causes a clear actionable error.

Recommendation: pin image version explicitly to match installed Playwright.

## Operational Checklist

- process user can read/write DB, artifact root, workspace root
- docker daemon reachable for docker-backed tools
- provider keys available when provider-backed features are expected
- API auth token configured before binding to a shared network interface
- secret key configured and backed up before creating secrets or credential vault bindings
- DB, artifact, and workspace directories included in the backup plan

