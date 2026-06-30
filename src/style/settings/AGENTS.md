# `src/style/settings/` — Settings UI CSS

Styles for the settings tab, including provider/model cards, MCP settings, slash commands, environment snippets, and agent configuration.

## Rules

- `base.css` owns shared settings-panel primitives; section files should extend those primitives instead of redefining them.
- Keep action buttons keyboard-visible and touch-friendly.
- Use status colors through Obsidian or `--pivi-*` variables.
- Import every new file through `../index.css`.
