# Operator UI Guide

This guide focuses on real operator workflows in the current UI.

## Navigation

- **Chat**: session-native chat interface with run-backed history, attachments, and live progress
- **Runs**: create runs and monitor recent status
- **Run Detail**: full execution surface (timeline, transcript, debug, events)
- **Agents**: reusable profiles for provider/model/system prompt/tools
- **Tools**: built-in tool inventory and status
- **Environments**, **Credential Vaults**, **Policies**: runtime resource management
- **Approvals**: policy-gated runs requiring human action
- **Settings**: provider and environment visibility

## Runs Page

Create run requires:

- `agent`
- `task`

Workspace is auto-managed by default. Advanced workspace controls are not shown in the default UI.

## Chat Page

Chat is a first-class operator surface:

- each user turn creates a new run in the active chat session
- messages are persisted in session order across runs
- attachments are uploaded into the current run and promoted into model context
- run-level message headers provide direct navigation to run detail
- approval chips appear only for real approval-request events

Behavior notes:

- Enter sends, Shift+Enter inserts newline
- drag/drop files on the composer to attach
- when no chat is active, recent session picker is shown inline

## Agents Page

### Create/Edit Agent

- unified provider/model field (`OpenAI/<model>` or `Anthropic/<model>`)
- system prompt with `AI Enhance` action
- allowed tools accordion (collapsed by default) with filterable grouped checkboxes

### AI Enhance

The button calls prompt enhancement API and rewrites the system prompt into a stronger runtime harness prompt.

### Delete Agent

- regular delete first
- if runs exist, operator is prompted for force delete (deletes run history, then agent)
- clear inline error feedback appears for blocked delete operations

## Run Detail Page

This is the primary operations and debugging surface.

### Header + Controls

- run status, provider/model, metrics
- interrupt, resume, approve, restart run, refresh, export bundle
- steer input: appends message and can continue/re-queue run

### Run Outcome

- final summarized result text
- output artifacts inline (including screenshot previews when available)

### Session Timeline

- lane-based timeline by actor category
- click spans for debug detail in Debug tab

### Transcript Tab

- each event row is an accordion
- expanded row includes:
  - embedded inspector payload JSON
  - per-step artifacts (logs/images/etc.)
- `Restart here` action available by step

### Debug Tab

- trace spans list
- tool calls list
- selected tool call request/response payloads

### Events Tab

- dense tabular event stream for quick scanning/filtering

## Approvals Workflow

When a run hits a policy gate:

1. status becomes `interrupted`
2. inspect context in transcript/debug
3. approve from run detail (or approvals view)
4. run continues from queued state

## Steering Workflow

Use steer to continue or redirect work:

1. enter instruction in steer input
2. submit
3. runtime appends instruction as a user message
4. run continues (including from completed/failed/cancelled/interrupted via auto re-queue behavior)

