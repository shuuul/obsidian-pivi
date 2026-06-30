# `src/pi/skills/` — Vault skill provisioning

Ensures default vault skills, tracks upstream skill bundle metadata, and notifies runtime/UI when skills change.

## Rules

- Default bundle is vault-local under `.pivi/skills/`.
- Keep network/update checks separate from local skill discovery.
- Do not mirror skills into editor-specific folders unless a feature explicitly requires it.
