# Development and Contributing

This guide is for contributors extending backend runtime, provider adapters, tooling, and UI surfaces.

## Local Setup

```bash
cd colosseum
make ui-install
go mod tidy
```

## Development Commands

From `colosseum/`:

- `make dev` – backend + Vite dev
- `make build` – production build with embedded UI
- `make test` – Go tests
- `make ui-build` – UI production build

From `colosseum/ui`:

- `npm run build`
- `npm run test`
- `npm run test:visual`

## Testing Strategy

## Backend

- unit/integration in `internal/*`
- provider adapter tests in `internal/providers`
- runtime integration tests in `internal/runtime`

## Frontend

- component tests via Vitest
- visual regression via Playwright

## Migrations

All schema changes must be additive migration files in:

- `internal/db/migrations`

Rules:

- never edit previously applied migration files
- add new numbered migration files
- keep backward-compatible evolution where possible

## Adding a New Built-in Tool

1. Add definition in `tools.Builtins()`.
2. Implement execution branch in `Executor.Execute`.
3. Ensure startup seeding updates `tool_defs`.
4. Add test coverage where appropriate.

## Adding a Custom Tool Kind

1. Extend `tool_defs.kind` handling in `Executor.customTool`.
2. Define expected `config_json` contract.
3. Add Tool Console UX support.
4. Add API and runtime validation tests.

## Adding a Provider Adapter

1. Implement `providers.Client`.
2. Normalize tool-calling semantics to internal `ToolCall`.
3. Capture usage metrics and raw payload.
4. Add parser and error-handling tests.

## Documentation Standards

- Keep docs aligned with actual routes and behavior.
- Update API docs for any endpoint changes.
- Update UI guide for any significant UX or workflow changes.
- Include troubleshooting entries for recurring operational errors.

## Release Checklist

- Go tests pass: `go test ./...`
- UI tests pass:
  - `npm run test`
  - `npm run test:visual`
- full build passes: `make build`
- docs updated for new capabilities

