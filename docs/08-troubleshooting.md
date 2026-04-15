# Troubleshooting

Common operational issues and fixes.

## Server does not start

### Symptom

- startup exits with bind error

### Fix

- change bind parameters:

```bash
./bin/colosseum server --listen-ip 127.0.0.1 --port 8090
```

or set `--bind`.

## Ready check fails

### Symptom

- `/readyz` returns error

### Fix

- ensure DB path is writable
- verify migration succeeded
- check filesystem permissions for db/artifacts/workspaces

## Run fails with provider 400 errors

### Examples

- invalid tool function name format
- tool-role message sequencing errors

### Fix

- ensure latest binary is running (provider adapter normalization fixes are included)
- verify tool names in registry are valid and non-empty
- inspect run transcript/debug events for malformed payloads

## Docker execution errors

### Symptom

- tool execution fails before command runs

### Fix

- verify docker daemon is running
- verify process user can run docker CLI
- verify configured image is pullable
- verify workspace path exists and is accessible

## Browser tool backend errors

### Symptom

- `browser.*` tool calls fail with docker runtime errors

### Fix

- verify docker daemon is running and accessible
- verify `COLOSSEUM_BROWSER_IMAGE` is pullable
- if needed, set `COLOSSEUM_BROWSER_MODE=local`
- keep `COLOSSEUM_BROWSER_FALLBACK=true` to auto-fallback from docker backend

## Custom tool test returns unknown tool

### Symptom

- `unknown tool` in test result

### Fix

- verify tool is enabled in `tool_defs`
- verify tool name is unique and saved correctly

## Runs remain interrupted

### Symptom

- run status does not progress after policy gate

### Fix

- approve from UI or `POST /api/runs/:id/approve`
- if needed, call resume endpoint

## UI seems stale

### Symptom

- run updates lag

### Fix

- verify SSE endpoint reachable: `/api/stream/runs/:id`
- hard-refresh browser if development assets changed

## Visual test snapshot mismatch

### Symptom

- Playwright visual tests fail after UI changes

### Fix

```bash
cd ui
npx playwright test --update-snapshots
npm run test:visual
```

## Fast diagnostics commands

```bash
# API health
curl -s http://127.0.0.1:8080/healthz
curl -s http://127.0.0.1:8080/readyz

# list runs
curl -s http://127.0.0.1:8080/api/runs

# inspect run telemetry
curl -s http://127.0.0.1:8080/api/runs/<run-id>/telemetry
```

