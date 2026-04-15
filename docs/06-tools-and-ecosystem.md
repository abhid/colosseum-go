# Tools and Ecosystem Console

This document covers advanced tool management and ecosystem operations.

## Tool Registry Model

Tool definitions are persisted in `tool_defs`.

Fields include:

- `name` (unique identifier)
- `description`
- `input_schema_json` (JSON schema-like contract)
- `kind` (`builtin`, `shell_command`, ...)
- `config_json` (executor-specific config)
- `enabled`
- `is_builtin`

At startup, built-in tools are seeded/upserted.

## Built-in vs Custom Tools

Built-ins:

- maintained by codebase
- immutable via API/UI

Custom tools:

- created/edited/deleted via API/UI
- runtime-discoverable and callable by model

## Built-in Tool Families (v1)

### Files and paths

- `file.read`
- `file.read_range`
- `file.write`
- `file.search`
- `file.exists`
- `file.stat`
- `file.list`
- `path.glob`
- `apply.patch`

### Web and JSON

- `web.fetch`
- `json.parse`
- `json.query`

### Browser (single-tab session)

- `browser.open`
- `browser.snapshot`
- `browser.action`
- `browser.wait`
- `browser.close`

Browser tools use a single-tab session per run and default to Docker-backed Playwright with local fallback when enabled.

## Custom Tool Kind: `shell_command`

Config:

- `command_template` with `{{param}}` placeholders
- `timeout_seconds`

Execution:

1. Runtime resolves tool by name.
2. Placeholder values are substituted from tool input.
3. Command executes in run workspace context.

## Tool Governance

Tool usage is bounded by:

- Agent `allowed_tools` list
- policy evaluation in runtime
- approval gating for risky shell actions

## Tool Test Runner

Use `POST /api/tools/:id/test` (or UI equivalent) to validate tool behavior.

Inputs:

- `workspace_path`
- tool `input` JSON

Outputs:

- `ok`
- `output`
- `log`
- optional `error`

## Ecosystem Entities

## Workflows

Stored in `workflow_defs` with arbitrary `definition_json`.

## Policies

Stored in `policies` and evaluated during tool execution.

## Secrets

Stored in `secrets` (value not returned by list endpoint).

## Provider Configs

Stored in `provider_configs` for profile-based provider wiring and future routing.

## Recommended Operational Pattern

1. Define tools and test them in isolation.
2. Apply policy constraints.
3. Bind tools to agent profiles.
4. Run with approvals enabled for risky actions.
5. Iterate from session debug timeline and run exports.

