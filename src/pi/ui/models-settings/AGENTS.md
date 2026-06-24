# `src/pi/ui/models-settings/` — Provider/model settings sections

UI helpers for provider credentials, environment variables, OAuth, model picker, checklist, and provider rows.

## Rules

- Keep credential writes routed through Pi auth services, not raw plugin settings.
- Model picker and checklist should use shared provider/model metadata.
- Use Obsidian `Setting` patterns and accessible row controls.
