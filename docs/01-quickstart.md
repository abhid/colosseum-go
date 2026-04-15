# Quickstart

This guide gets `colosseum` running locally in minutes.

## Prerequisites

- Linux host (x86_64 or arm64)
- Docker daemon available to the current user
- Go toolchain compatible with this repository
- Node.js + npm (only required for UI development or rebuilding UI assets)
- At least one model provider key:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`

## Build

```bash
cd colosseum
make build
```

This produces `bin/colosseum` with embedded UI assets.

## Start Server

```bash
OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
./bin/colosseum server --port 8080
```

Open:

- UI: `http://127.0.0.1:8080`
- Health check: `http://127.0.0.1:8080/healthz`
- Readiness check: `http://127.0.0.1:8080/readyz`

Notes:

- Default listen IP is `0.0.0.0` (all interfaces).
- Environment variables can come from shell exports or `.env` / `.env.local`.

## First End-to-End Run

1. Go to **Agents**.
2. Create an agent profile:
   - name + description
   - provider/model
   - system prompt
   - allowed tools
3. Go to **Runs** and create a run with:
   - agent
   - task
4. Open **Run Detail** and monitor:
   - run outcome
   - timeline
   - transcript accordions (inspector + per-step artifacts)
5. If policy gates a tool call, approve and continue.

Notes:

- Workspaces are auto-managed by default under `COLOSSEUM_WORKSPACE_ROOT`.
- Browser artifact previews (screenshots) are available directly from run detail.
- Steering a run appends a new user message and can re-queue terminal runs for continuation.

## Shutdown Behavior

- `Ctrl+C` once: graceful shutdown
- `Ctrl+C` again: immediate exit

## Local Dev Mode

```bash
cd colosseum
make ui-install
make dev
```

`make dev` runs backend + Vite dev server for iterative frontend/backend development.

