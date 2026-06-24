# `src/features/settings/` — Obsidian settings feature

Plugin settings tab composition, keyboard navigation mapping, environment snippets, MCP settings, and agent-specific settings sections exposed through core workspace ports.

## Rules

- Use Obsidian `PluginSettingTab`, `Setting`, and `Modal` APIs for settings UI.
- Agent-specific settings rendering comes from `AgentWorkspace`; do not import Pi UI directly here.
- Persist through plugin/settings coordinators and provide rollback/user-readable errors for failed saves.
