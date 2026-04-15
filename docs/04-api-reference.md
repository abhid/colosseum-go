# API Reference

Base path: `/api`

All endpoints return JSON unless otherwise noted.

## Health

- `GET /healthz`
- `GET /readyz`

## Agents

- `POST /agents` create agent
- `GET /agents` list agents
- `PUT /agents/:id` update agent

Example create payload:

```json
{
  "name": "Code Fixer",
  "description": "Autonomous code repair",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "system_prompt": "Be concise and safe.",
  "allowed_tools": ["shell.exec", "file.read", "file.write"]
}
```

## Runs

- `POST /runs` create run
- `GET /runs` list runs
- `GET /runs/:id` get run
- `GET /runs/:id/trace` event trace
- `GET /runs/:id/telemetry` steps/tool_calls/spans/events
- `GET /runs/:id/artifacts` list artifacts
- `GET /runs/:id/export` download run bundle
- `POST /runs/:id/cancel`
- `POST /runs/:id/interrupt`
- `POST /runs/:id/resume`
- `POST /runs/:id/approve`
- `POST /runs/:id/events` append steering event
- `GET /stream/runs/:id` SSE stream

Example run payload:

```json
{
  "agent_id": "agent-id",
  "task": "Fix failing tests and summarize changes",
  "source_workspace_path": "/home/user/repo",
  "max_steps": 30
}
```

## Tools

- `GET /tools`
- `POST /tools`
- `PUT /tools/:id`
- `DELETE /tools/:id`
- `POST /tools/:id/test`

Example custom tool:

```json
{
  "name": "repo.scan",
  "description": "Scan repository metadata",
  "kind": "shell_command",
  "input_schema": {
    "type": "object",
    "properties": { "pattern": { "type": "string" } },
    "required": ["pattern"]
  },
  "config_json": {
    "command_template": "rg -n '{{pattern}}' .",
    "timeout_seconds": 120
  },
  "enabled": true
}
```

## Workflows

- `GET /workflows`
- `POST /workflows`
- `PUT /workflows/:id`
- `DELETE /workflows/:id`

## Policies

- `GET /policies`
- `POST /policies`
- `PUT /policies/:id`
- `DELETE /policies/:id`

## Secrets

- `GET /secrets` (metadata only)
- `POST /secrets`
- `DELETE /secrets/:name`

## Provider Configs

- `GET /provider-configs`
- `POST /provider-configs`
- `PUT /provider-configs/:id`
- `DELETE /provider-configs/:id`

## Providers

- `GET /providers` static capabilities list

## SSE Stream Format

Endpoint: `GET /api/stream/runs/:id`

Event type:

- `run_event`

Data payload includes:

- `id`
- `step_id`
- `event_type`
- `seq`
- `payload`
- `created_at`

