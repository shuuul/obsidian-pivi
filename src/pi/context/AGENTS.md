# `src/pi/context/` — Pi context layer loading

Loads context layers that feed Pi runtime/system prompt construction.

## Rules

- Keep context loading deterministic and vault-local where possible.
- Do not mix UI mention parsing with runtime context-layer assembly.
