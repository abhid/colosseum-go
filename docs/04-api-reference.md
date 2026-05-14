# API Reference

Base path: `/api`

All endpoints return JSON unless otherwise noted.

When `COLOSSEUM_API_AUTH_TOKEN` is configured, API requests must include `Authorization: Bearer <token>` or `X-API-Token: <token>`. Native EventSource clients may pass `access_token=<token>` for `/api/stream/*`.

## Health

- `GET /healthz`
- `GET /readyz`

## Agents

- `POST /agents`
- `GET /agents`
- `PUT /agents/{id}`
- `DELETE /agents/{id}`

Agent delete supports force mode:

- `DELETE /agents/{id}?force=1`
- force mode deletes run history owned by the agent, then deletes the agent

Create/update payload:

```json
{
  "name": "Code Fixer",
  "description": "Autonomous code repair",
  "provider": "openai",
  "model": "gpt-5.4",
  "system_prompt": "Be concise and safe.",
  "allowed_tools": ["shell.exec", "file.read", "apply.patch"]
}
```

## Providers and Prompt Enhancement

- `GET /providers`
- `GET /providers/openai/models`
- `POST /prompts/enhance`

Enhance payload:

```json
{
  "prompt": "You are a coding assistant.",
  "provider": "openai",
  "model": "gpt-5.4"
}
```

## Runs

- `POST /runs`
- `GET /runs`
- `GET /runs/{id}`
- `POST /runs/{id}/replay`
- `GET /runs/{id}/trace`
- `GET /runs/{id}/telemetry`
- `GET /runs/{id}/artifacts`
- `GET /runs/{id}/artifacts/{artifactID}/content` (raw file content stream)
- `POST /runs/{id}/files` (multipart `files[]` upload)
- `GET /runs/{id}/export`
- `POST /runs/{id}/cancel`
- `POST /runs/{id}/interrupt`
- `POST /runs/{id}/resume`
- `POST /runs/{id}/approve`
- `POST /runs/{id}/events` (steer message append + auto re-queue for terminal/interrupted runs)

Create run payload:

```json
{
  "agent_id": "agent-id",
  "task": "Fix failing tests and summarize changes",
  "provider": "openai",
  "model": "gpt-5.4",
  "max_steps": 30
}
```

Steer event payload example:

```json
{
  "message": "Continue from the last result and include exact commands used."
}
```

## Chat Sessions

- `GET /chat/sessions`
- `POST /chat/sessions`
- `GET /chat/sessions/{id}`
- `PATCH /chat/sessions/{id}`
- `GET /chat/sessions/{id}/messages`
- `POST /chat/sessions/{id}/messages`
- `POST /chat/sessions/{id}/attachments`

`POST /chat/sessions/{id}/messages` accepts JSON:

```json
{
  "content": "Summarize the uploaded screenshot.",
  "source": "chat"
}
```

It also accepts multipart form data with `content` and one or more `files` fields. Multipart chat sends persist attachments before the run is queued for execution.

## Tools

- `GET /tools`
- `POST /tools`
- `PUT /tools/{id}`
- `DELETE /tools/{id}`
- `POST /tools/{id}/test`

Custom tool (`shell_command`) example:

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

## Policies

- `GET /policies`
- `POST /policies`
- `PUT /policies/{id}`
- `DELETE /policies/{id}`

## Secrets

- `GET /secrets` (metadata only)
- `POST /secrets`
- `DELETE /secrets/{name}`

`POST /secrets` requires `COLOSSEUM_SECRET_KEY` on the server.

## Provider Configs

- `GET /provider-configs`
- `POST /provider-configs`
- `PUT /provider-configs/{id}`
- `DELETE /provider-configs/{id}`
- `POST /provider-configs/{id}/test`

## Environments

- `GET /environments`
- `POST /environments`
- `PUT /environments/{id}`
- `DELETE /environments/{id}`

## Credential Vaults

- `GET /credential-vaults`
- `POST /credential-vaults`
- `PUT /credential-vaults/{id}`
- `DELETE /credential-vaults/{id}`
- `GET /credential-vaults/{id}/items`
- `POST /credential-vaults/{id}/items`
- `DELETE /credential-vaults/{id}/items/{secretName}`

## SSE Stream

Endpoint:

- `GET /api/stream/runs/{id}`

Event name:

- `run_event`

Data payload fields:

- `id`
- `step_id`
- `event_type`
- `seq`
- `payload`
- `created_at`

