# `src/core/auxiliary/` — Query-backed auxiliary services

Provider-neutral adapters that turn an `AuxQueryRunner` into inline edit and title-generation services.

## Rules

- Keep prompts and response parsing deterministic and provider-neutral.
- Auxiliary services should depend on the `AuxQueryRunner` contract, not a concrete runtime SDK.
- Preserve explicit mode/context inputs for inline edit; avoid reading UI state directly.
