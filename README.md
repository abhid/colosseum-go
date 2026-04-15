# colosseum

`colosseum` is a self-hosted agent runtime and operations console for autonomous coding and web/ops workflows.

It combines:

- a single binary API/runtime server
- SQLite-backed durable run history
- tool-enabled model orchestration
- policy + approval gates
- rich run telemetry and artifacts
- an embedded React operator UI

## Why Colosseum

`colosseum` is designed for teams that want deterministic, inspectable agent execution instead of black-box chat sessions. It emphasizes:

- **Operator control**: interrupt, resume, approve, steer
- **Traceability**: every run is recorded as steps, events, spans, tool calls, and artifacts
- **Tool governance**: explicit allowlists + policy checks
- **Practical deployment**: single-node binary with no external control-plane dependencies

## Key Capabilities

- **Agents** with provider/model/system prompt/tool allowlist profiles
- **Runs** with replay/restart and steerable continuation
- **Built-in tools** for shell, files, glob/patch, web/json, browser automation, and artifacts
- **Browser runtime** via Playwright in Docker by default, with optional local fallback
- **Prompt enhancement** endpoint for generating stronger system prompts
- **Dynamic provider/model UX** (provider visibility based on configured credentials; OpenAI model listing via API)
- **Export bundles** for offline debugging and sharing

## Quick Start

```bash
cd colosseum
make build

OPENAI_API_KEY=... \
ANTHROPIC_API_KEY=... \
./bin/colosseum server --listen-ip 127.0.0.1 --port 8080
```

Then open `http://127.0.0.1:8080`.

## Documentation

- [Documentation Index](docs/README.md)
- [Quickstart](docs/01-quickstart.md)
- [Architecture](docs/02-architecture.md)
- [Configuration](docs/03-configuration.md)
- [API Reference](docs/04-api-reference.md)
- [Operator UI Guide](docs/05-operator-ui-guide.md)
- [Tools and Ecosystem](docs/06-tools-and-ecosystem.md)
- [Security and Reliability](docs/07-security-reliability.md)
- [Troubleshooting](docs/08-troubleshooting.md)
- [Development and Contributing](docs/09-development-contributing.md)

## Core Runtime Objects

- **Agent**: reusable execution profile (`provider`, `model`, `system_prompt`, `allowed_tools`)
- **Run**: one execution instance for an agent + task
- **Step**: a single model iteration
- **Tool Call**: one tool invocation in a step
- **Event / Span**: ordered telemetry and timeline diagnostics
- **Artifact**: persisted output (logs, screenshots, patches, generated files)

## Repository Layout

```text
colosseum/
  cmd/colosseum             # binary entrypoint
  internal/
    api                     # HTTP routes + SSE + UI hosting
    config                  # env/flag parsing
    db                      # SQLite schema + migrations
    docker                  # docker lifecycle helpers
    evals                   # evaluation suites/runs
    policy                  # tool policy and approval gating
    providers               # OpenAI/Anthropic adapters
    runtime                 # orchestration loop
    tools                   # builtin/custom tools + browser runtime
  ui/                       # React + TypeScript frontend
  docs/                     # docs set
```

## Scope

`colosseum` is optimized for single-node internal operations. It is not currently a distributed scheduler or multi-region control plane.

