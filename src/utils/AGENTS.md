# `src/utils/` — Cross-cutting helpers

Framework-neutral helpers used by core, features, and the Pi adaptor. Keep utilities small and side-effect free unless the filename explicitly describes a platform patch.

## Helper groups

```mermaid
flowchart TD
  Context["context/externalContext/contextMentionResolver"] --> Prompt["turn prompt inputs"]
  Editor["editor/inlineEdit/diff/vaultEditMatch"] --> UI["chat + inline edit UI"]
  Platform["electronCompat/obsidianCompat/browser/env/path/nodeFetch"] --> Runtime["Obsidian/Electron runtime"]
  Content["markdown/markdownMath/fileLink/imageEmbed/frontmatter"] --> Rendering["message rendering + note ops"]
  Agent["agent/session/subagentJsonl/interrupt/slashCommand"] --> Pi["agent/session helpers"]
  Mcp["mcp"] --> Core["core MCP mention semantics"]
```

## Rules

- Avoid adding domain orchestration here; put stable domain rules in `src/core/` and feature-specific behavior in `src/features/`.
- Keep side effects explicit. Compatibility patches must be called intentionally from entry points (`main.ts` does this for renderer patches).
- Prefer pure functions and typed inputs/outputs; avoid hidden global state.
- Be careful with Obsidian/mobile compatibility: avoid browser/Node assumptions unless guarded by the caller or helper.
