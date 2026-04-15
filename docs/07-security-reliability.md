# Security and Reliability

This guide summarizes practical security posture and reliability behavior in the current implementation.

## Security Posture

## Execution isolation

- Commands are intended to execute in Docker run workspaces.
- Workspace paths are constrained and mounted into container runtime.

## Tool boundaries

- Tool definitions are explicit and schema-driven.
- Unknown tools are rejected.
- Agent-level `allowed_tools` can restrict callable tools.

## Risk controls

- Policy checks run before tool execution.
- Risky commands can require explicit human approval.

## Secret handling

- Secrets are persisted and not returned in list payloads.
- Runtime logs and traces should avoid raw secret exposure.

## Recommendations

- run `colosseum` under least-privilege OS account
- keep workspace/artifact roots scoped and isolated
- use dedicated Docker daemon/profile for agent workloads
- rotate provider credentials regularly
- enforce outbound restrictions at host/network layer

## Reliability Model

## Durable state

Core run state and telemetry are persisted in SQLite:

- runs
- steps
- tool calls
- events
- spans

## Recovery behavior

- in-flight `running` runs are re-queued on startup
- runtime can resume execution from persisted state
- operator can interrupt/resume/approve from UI/API

## Timeouts and retries

- model call retries with exponential backoff
- tool command timeout enforcement
- output truncation protection for large logs

## Graceful shutdown

- first `Ctrl+C` triggers quick graceful shutdown
- second `Ctrl+C` forces immediate process exit
- runtime workers observe cancellation context

## Known Current Limits

- single-node architecture (no distributed scheduler yet)
- SQLite local durability (no HA DB replication)
- policy engine currently focused on practical guardrails, not formal policy DSL

