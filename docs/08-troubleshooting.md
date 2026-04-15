# Troubleshooting

Common issues and direct fixes.

## Server Start / Port Bind Errors

Symptom:

- startup fails with bind/listen error

Fix:

```bash
./bin/colosseum server --port 8090
```

or set `--bind`.

## `/readyz` Fails

Symptom:

- health works, readiness fails

Fix:

- verify DB path is writable
- confirm migrations applied successfully
- check permissions for DB/artifacts/workspaces roots

## Changes “Didn’t Work”

Symptom:

- behavior still old after code edits

Cause:

- running binary predates source changes

Fix:

```bash
make build
# restart running server process
./bin/colosseum server --port 8080
```

## Browser Tool Errors

### Playwright version mismatch

Symptom:

- browser launch errors referencing missing executable/module

Fix:

- align `COLOSSEUM_BROWSER_IMAGE` version with installed Playwright version
- keep browser fallback enabled if desired:
  - `COLOSSEUM_BROWSER_FALLBACK=true`

### Docker unavailable

Symptom:

- `docker browser exec failed ...`

Fix:

- confirm Docker daemon access for runtime user
- pull browser image manually
- switch to local mode if needed:
  - `COLOSSEUM_BROWSER_MODE=local`

## Artifact Open/Preview Fails

Symptom:

- screenshot artifact cannot be opened

Fix:

- ensure server is running a build that includes artifact content endpoint and browser screenshot path rewrite fixes
- regenerate screenshot artifacts after restart if old records reference container-only paths

## Agent Delete Fails

Symptom:

- delete button appears non-functional

Fix:

- UI now surfaces exact backend reason
- if blocked by runs, use force delete confirmation flow to remove run history and delete agent
- if blocked by eval suite references, remove/reassign suite first

## Steer Event Does Not Continue Run

Symptom:

- steering completed/interrupted run appears ignored

Fix:

- verify server restarted with steer-continuation patch
- check `POST /api/runs/{id}/events` response status
- confirm run transitions back to `queued` and receives new `user.event`

## Runs Stay Interrupted

Symptom:

- run never resumes after policy gate

Fix:

- approve: `POST /api/runs/{id}/approve`
- resume if needed: `POST /api/runs/{id}/resume`

## UI Appears Stale

Symptom:

- run detail not updating live

Fix:

- verify SSE endpoint: `/api/stream/runs/{id}`
- hard-refresh browser when frontend assets changed

## Fast Diagnostics

```bash
# health
curl -s http://127.0.0.1:8080/healthz
curl -s http://127.0.0.1:8080/readyz

# runs
curl -s http://127.0.0.1:8080/api/runs

# telemetry
curl -s http://127.0.0.1:8080/api/runs/<run-id>/telemetry

# artifacts
curl -s http://127.0.0.1:8080/api/runs/<run-id>/artifacts
```

