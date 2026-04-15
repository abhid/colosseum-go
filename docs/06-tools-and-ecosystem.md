# Tools and Ecosystem

This guide covers tool architecture, runtime behavior, and ecosystem entities.

## Tool Registry Model

Definitions live in `tool_defs` with fields such as:

- `name` (unique identifier)
- `description`
- `input_schema_json`
- `kind` (`builtin`, `shell_command`, ...)
- `config_json`
- `enabled`
- `is_builtin`

Built-ins are upserted at startup and treated as immutable in UI/API.

## Built-in Tool Set

### Shell and Filesystem

- `shell.exec`
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

### Browser

- `browser.open`
- `browser.snapshot`
- `browser.action`
- `browser.wait`
- `browser.close`

### Run Artifacts and Utility

- `artifact.list`
- `artifact.get`
- `test.run`

## Browser Runtime Details

Browser tools are single-session-per-run and support:

- Docker-backed Playwright by default
- optional local fallback
- screenshot artifact persistence

Recommended operation:

- pin `COLOSSEUM_BROWSER_IMAGE` to the exact Playwright version in use
- keep fallback enabled for resilience during local/dev setups

## Custom Tools

Current custom kind:

- `shell_command`

Key config:

- `command_template` with `{{param}}` placeholders
- `timeout_seconds`

Execution flow:

1. resolve definition by tool name
2. render template from input args
3. execute in run workspace context
4. return output/log artifacts

## Tool Governance

Tool execution is controlled by:

- agent-level `allowed_tools`
- policy engine evaluation (`allow`, `deny`, `require approval`)
- tool-specific guardrails (for example host/scheme checks for web/browser tools)

## Tool Testing

Use tool test runner (`POST /api/tools/{id}/test`) or UI test console.

Input:

- workspace path
- JSON tool input

Output:

- `ok`
- `output`
- `log`
- optional `error`

## Ecosystem Resources

### Workflows

- stored in `workflow_defs`
- optional links to runs via `workflow_runs`

### Policies

- stored in `policies`
- evaluated before tool execution

### Secrets

- stored in `secrets`
- list endpoints do not return secret plaintext

### Provider Configs

- stored in `provider_configs`
- used for provider profile management and future routing patterns

## Practical Rollout Pattern

1. enable minimum required tools for each agent
2. test custom tools in isolation
3. apply policy gates for risky operations
4. monitor run telemetry and artifacts
5. iterate based on transcript/debug evidence

