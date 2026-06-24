# `src/features/` — Obsidian user-facing features

Feature/application layer for chat, settings, and inline edit. Features may use Obsidian UI APIs, shared widgets, utilities, and core facades; they must not import `src/pi/**` directly.

## Map

```mermaid
flowchart TD
  Chat["chat/<br/>sidebar sessions"] -- "core facades" --> Core["core/agent + runtime"]
  Settings["settings/<br/>PluginSettingTab"] -- "workspace/settings ports" --> Core
  Inline["inline-edit/<br/>CodeMirror modal"] -- "inline service" --> Core
  Shared["../shared"] -- "widgets" --> Chat
  Shared -- "widgets" --> Settings
  Shared -- "widgets" --> Inline
```

## Rules

- Feature code owns UI composition and Obsidian interactions, not provider/runtime implementation.
- Runtime work goes through `AgentServices`, `AgentWorkspace`, or explicit core contracts.
- Keep DOM cleanup and stale-tab guards close to the component/controller that registers async work.
