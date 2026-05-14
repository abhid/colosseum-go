# Security and Reliability

This guide summarizes the current operational security posture and runtime reliability behavior.

## Security Model

### Execution Isolation

- tool execution is workspace-scoped
- Docker-backed execution is the default model for browser tooling
- path handling includes confinement checks in file/path tool handlers

### Tool Boundaries

- explicit tool registry definitions with schemas
- unknown/disabled tools are rejected
- per-agent `allowed_tools` restricts callable surface area

### Policy and Approval Gates

- policy engine evaluates each tool call
- decisions: allow / deny / require approval
- high-risk actions can force `interrupted` state until operator approval

### Provider and Secret Safety

- provider credentials are supplied via environment variables
- secrets store endpoints do not leak plaintext in list views
- creating secrets requires `COLOSSEUM_SECRET_KEY`
- dynamic provider visibility reduces accidental misconfiguration in UI

### Network/Data Guardrails

- web/browser tools include host/scheme validation paths
- local/metadata targets can be blocked or approval-gated by policy
- URL checks parse schemes and hosts, recognize common local/private IP forms, and block metadata-service targets

## Reliability Model

### Durable State

Primary execution history is persisted in SQLite:

- runs, run_steps, tool_calls
- events, trace_spans
- approvals
- artifacts

### Recovery Semantics

- startup recovery re-queues stale `running` runs
- operator can resume/interrupt/approve at runtime
- steer events append new user messages and can continue terminal runs

### Browser Reliability

- docker-first browser execution
- optional local fallback
- explicit Playwright version matching guard to avoid mismatched image/runtime failures

### Fault Tolerance

- model retries with exponential backoff
- tool timeout controls
- bounded output handling for large payloads
- run status transitions are persisted at each major boundary

## Operational Hardening Checklist

- run under a least-privilege OS account
- isolate DB/artifact/workspace directories with strict permissions
- set `COLOSSEUM_API_AUTH_TOKEN` for every shared deployment
- set and back up `COLOSSEUM_SECRET_KEY` before creating secrets
- use constrained Docker context/profile for agent workloads
- pin browser image versions to known-good builds
- rotate provider credentials and audit environment handling
- apply egress/network controls at host or network boundary

## Current Limits

- single-node architecture (no distributed scheduler)
- SQLite local durability (no built-in HA replication)
- policy model is pragmatic and rule-based, not a full policy DSL

