# Output Contract Validation

Colosseum supports optional output contracts on agents and per-run overrides.

## Contract Types

- `none`: no validation.
- `regex`: the final model response must match the regex payload.
- `json_schema`: the final model response must parse as JSON and satisfy the supported schema subset (`type`, `required`, `properties`).

## Runtime Semantics

- Validation executes immediately before a run would be marked successful.
- Runtime emits `output_contract.validated` for both pass and fail outcomes.
- Runtime emits `output_contract.failed` with concise reason metadata on failure.
- Contract validation failure marks the run as `failed`.
- `run.completed` is not emitted when output contract validation fails.

## API and Data Model

- Agents store defaults in `output_contract_type` and `output_contract_payload`.
- Runs store effective values in `output_contract_type` and `output_contract_payload`.
- API validates malformed regex and malformed JSON schema payloads at request boundary.

## Reliability Constraints

- Validation input is capped to avoid unbounded memory usage.
- Invalid JSON output, invalid regex definitions, and invalid schema payloads fail gracefully with structured error reasons.
