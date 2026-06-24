# `src/pi/session/` — Pi JSONL session bridge

Maps Pi agent messages and session tree data to Obsius session files under `.obsius/sessions/`.

## Rules

- Durable identity is session file + leaf id; runtime state is rebuildable.
- Keep Pi SDK message mapping isolated in this directory.
- Use session path helpers for vault-relative vs absolute path conversion.
- Preserve custom Obsius metadata types when reading/writing JSONL.
