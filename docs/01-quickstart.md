# Quickstart

This guide gets `colosseum` running locally with a working UI and API in minutes.

## Prerequisites

- Linux host (x86_64 or arm64)
- Docker daemon available to the current user
- Go toolchain compatible with this repository
- Node.js + npm (for local UI development only)
- At least one provider key:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`

## Build

From the repository root:

```bash
cd colosseum
make build
```

This compiles the backend and embeds built UI assets into `bin/colosseum`.

## Run

```bash
OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
./bin/colosseum server --listen-ip 127.0.0.1 --port 8080
```

Open:

- UI: `http://127.0.0.1:8080`
- Health: `http://127.0.0.1:8080/healthz`
- Ready: `http://127.0.0.1:8080/readyz`

## First End-to-End Run

1. Go to **Agents** and create an agent.
2. Go to **Runs** and submit a task.
3. Leave `workspace_path` empty to let `colosseum` auto-manage it.
4. Optionally set `source_workspace_path` to clone/seed an existing directory.
5. Open run detail and monitor:
   - Transcript
   - Debug timeline
   - Events
6. If interrupted by approval policy, approve and resume.

## Shutdown

- `Ctrl+C` once: graceful and quick shutdown
- `Ctrl+C` twice: immediate forced exit

## Local Development Mode

Use split dev mode if iterating on UI + backend:

```bash
cd colosseum
make ui-install
make dev
```

This starts:

- backend server
- Vite frontend dev server

