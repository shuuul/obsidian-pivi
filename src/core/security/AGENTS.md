# `src/core/security/` — Tool approval policy helpers

Pure approval state and pattern matching for tool execution rules.

## Rules

- Keep session approval rules explicit and serializable.
- Do not bypass approval checks in Pi tool/runtime code; extend these helpers when policy semantics change.
- Prefer deny/ask-safe behavior for unknown or malformed approval patterns.
