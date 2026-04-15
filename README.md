# colosseum

A self-hosted managed-agent harness for autonomous coding and operations workflows.

`colosseum` provides a single-binary control plane with Docker-isolated execution, SQLite-backed state, rich traces, artifacts, approvals, policy checks, and a modern web UI for end-to-end run operations.

## Highlights

- Single Linux binary (`colosseum`) for API + runtime + embedded UI
- Docker sandbox execution per run workspace
- Multi-step model/tool orchestration with resumable runs
- Built-in and custom tool registry with UI management + test runner
- Live observability with SSE and session timeline views
- Policy checks and approval gates for risky operations
- Provider support for Anthropic and OpenAI
- Exportable run bundles for replay and debugging

## Docs

- [Quickstart](docs/01-quickstart.md)
- [Architecture](docs/02-architecture.md)
- [Configuration](docs/03-configuration.md)
- [API Reference](docs/04-api-reference.md)
- [Operator UI Guide](docs/05-operator-ui-guide.md)
- [Tools and Ecosystem Console](docs/06-tools-and-ecosystem.md)
- [Security and Reliability](docs/07-security-reliability.md)
- [Troubleshooting](docs/08-troubleshooting.md)
- [Development and Contributing](docs/09-development-contributing.md)

## Fast Start

```bash
cd colosseum

# Build backend + embedded UI
make build

# Start server
OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
./bin/colosseum server --listen-ip 127.0.0.1 --port 8080
```

Open `http://127.0.0.1:8080`.

## Runtime Model

Core entities:

- **Agent**: reusable model + policy + tool profile
- **Run**: one execution of an agent on a task
- **Step**: one model iteration in a run
- **Tool Call**: one invoked tool action with structured I/O
- **Trace Span / Event**: observability timeline primitives
- **Artifact**: files generated during execution (logs, patches, outputs)

## Project Layout

```text
colosseum/
  cmd/colosseum             # binary entrypoint
  internal/
    api                     # HTTP routes + SSE + UI asset serving
    config                  # env/flag config model
    db                      # SQLite + migrations
    docker                  # docker lifecycle/exec integration
    policy                  # risk/approval policy checks
    providers               # Anthropic/OpenAI adapters
    runtime                 # orchestration loop + session contracts
    tools                   # built-ins + custom tool execution
  ui/                       # React + TypeScript frontend
  docs/                     # documentation
```

## Current Scope Notes

`colosseum` is production-oriented for single-node internal workflows and operator-led usage. It is not yet a distributed orchestration platform and does not yet include Kubernetes-native scheduling.

