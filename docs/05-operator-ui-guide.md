# Operator UI Guide

The UI is designed for active run operations and deep debugging.

## Main Navigation

- **Runs**: submit and monitor runs
- **Session Detail**: transcript/debug/events + controls
- **Agents**: create/edit reusable agent profiles
- **Tools**: manage tool registry and test tools
- **Ecosystem**: workflows, policies, secrets, provider configs
- **Approvals**: interrupted runs requiring operator action
- **Settings**: provider capability and environment status

## Runs Page

Use this page to:

- create runs from agents
- set optional workspace path
- seed from source workspace path
- inspect recent run status quickly

## Session Detail Page

`Session Detail` is the primary operations and debugging surface.

### Header controls

- interrupt / resume run
- approve pending gate
- export run bundle
- send steering message

### Transcript tab

- chronological event transcript
- readable payload rendering
- filter by event text/payload

### Debug tab

- multi-lane timeline (model/tools/system)
- click span segments to inspect details
- right-side inspector for selected span metadata

### Events tab

- dense tabular event feed
- raw payload-first inspection mode

### Artifacts section

- lists logs/outputs/patch artifacts
- copy artifact path directly

## Tools Console

Use Tools Console to:

- create custom tools
- edit and enable/disable custom tools
- view built-in tool definitions
- test tools against a target workspace with JSON inputs

Built-in tools are immutable by design.

## Ecosystem Console

Use this console to centrally manage:

- workflow templates
- policy definitions
- secrets metadata + lifecycle
- provider configuration profiles

## Approvals

Runs that trigger risky actions can enter `interrupted` state.

Operator flow:

1. Open run details
2. Review transcript/debug context
3. Approve to re-queue and continue

