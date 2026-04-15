# Development and Contributing

This guide is for contributors extending runtime behavior, APIs, tools, and UI.

## Local Setup

```bash
cd colosseum
make ui-install
go mod tidy
```

## Daily Commands

From repo root:

- `make dev` backend + Vite dev
- `make build` production build (embedded UI)
- `make test` Go tests
- `make ui-build` UI production build

From `ui/`:

- `npm run build`
- `npm run test`
- `npm run test:visual`

## Test Expectations

### Backend

- unit/integration coverage under `internal/*`
- provider adapter tests in `internal/providers`
- orchestration tests in `internal/runtime`
- tool/policy tests when changing tool execution or guardrails

### Frontend

- compile cleanly (`npm run build`)
- maintain behavior in run/agents/tools surfaces
- update visual tests where snapshots are intentionally changed

## Migration Rules

Schema changes must be additive migration files under `internal/db/migrations`.

Rules:

- never edit previously-applied migrations
- add a new numbered migration
- preserve backward compatibility where feasible

## Extending Built-in Tools

1. add definition in `internal/tools` builtins registry
2. add execution branch in `Executor.Execute`
3. apply policy changes if needed (`internal/policy`)
4. add tests for handler behavior and policy decisions
5. update docs (`06-tools-and-ecosystem.md`, API docs if needed)

## Extending Runtime Behavior

When changing run lifecycle (resume, steer, replay, completion semantics):

1. update `internal/runtime`
2. verify status transitions + persisted events
3. test interaction with approvals/policy/tool execution
4. update operator docs and troubleshooting sections

## Provider Integration Guidelines

1. implement `providers.Client`
2. normalize tool-calling semantics to internal shape
3. include usage extraction
4. ensure robust error handling and retries

## Documentation Quality Bar

For any feature change:

- API route and payloads documented
- operator-visible behavior documented
- configuration knobs documented
- troubleshooting entries added for likely failure modes

## Release Checklist

- `go test ./...` passes
- `npm run build` passes in `ui/`
- `make build` passes
- docs updated and consistent with shipped behavior

