# Response and Media Pipeline

This document describes how Colosseum converts raw model output and uploaded attachments into final user-facing chat responses with deterministic guarantees.

## Goals

- keep responses user-facing and concise
- prevent artifact/link drift from rewritten outputs
- ensure attachment claims remain valid and resolvable
- support multimodal input paths for image attachments
- avoid stale attachment context across turns

## End-to-End Flow

```mermaid
flowchart TD
  A[User message + optional attachments] --> B[API stores run + artifacts]
  B --> C[user.event appended with attachment metadata]
  C --> D[Runtime builds provider message list]
  D --> E[Model step executes]
  E --> F[Dispatcher synthesis (conditional)]
  F --> G[Deterministic contract checks]
  G --> H[Persist chat message]
  H --> I[run.completed]
```

## Stage 1: Input Assembly

For chat turns with attachments:

1. uploaded files are persisted as artifacts
2. `run.files_uploaded` event is emitted
3. `user.event` is emitted with:
   - `source = "chat.attachments"`
   - `attachments = [artifact_id, ...]`
   - a user-readable attachment message

Runtime consumes `user.event` and builds provider messages:

- normal text remains `Message.Content`
- attachment media is transformed into `Message.ContentParts`

## Stage 2: Media Capability Policy

Runtime uses a media policy object to decide how each MIME type is represented:

- `buildMediaInputPolicy(provider, model)` defines:
  - direct multimodal MIME set
  - size limits
  - max content parts
- `buildAttachmentContentParts(...)` applies MIME-specific transforms

Current default behavior:

- direct multimodal image part: `png`, `jpeg/jpg`, `webp`, `gif`
- SVG fallback: extracted textual metadata (`title/desc/text`) as structured text
- unknown image MIME fallback: metadata text note

## Stage 3: Latest Attachment Wins

When a new `chat.attachments` user event arrives in a run:

- prior attachment-context user messages are removed from in-memory prompt context
- newest attachment context is retained

This prevents older uploads from competing with the latest requested image in follow-up turns.

## Stage 4: Dispatcher Synthesis (Conditional)

Dispatcher is not always-on rewrite.

`shouldDispatchAssistantResponse(...)` gates rewriting to noisy outputs:

- UUID-heavy dumps
- artifact metadata dumps
- telemetry-like leakage
- artifact-link-heavy outputs requiring normalization

If output is already user-facing, raw model text is passed through.

## Stage 5: Deterministic Output Contracts

After synthesis, runtime enforces:

1. **provenance media contract**
   - attachment claims must match existing artifacts
   - required attachment links must be resolvable
2. **configured output contract**
   - `none`, `regex`, or `json_schema`

Only after all checks pass does runtime append assistant chat output and mark `run.completed`.

## Failure Semantics

- contract failure -> `output_contract.failed` event + run failure
- no false "success" with unresolved attachment claims
- no duplicate pre-failure + failure system bubbles

## Why This Design

- LLM handles language quality and summarization.
- Deterministic checks enforce correctness boundaries.
- Media policy centralizes provider/model capability handling.
- Event metadata (not string guessing) drives attachment context updates.

## Operational Tips

- If behavior looks stale after upgrades, rebuild and restart server binary.
- Inspect run telemetry for:
  - `run.files_uploaded`
  - `user.event` with `source=chat.attachments`
  - `response.dispatch.*`
  - `output_contract.validated|failed`

