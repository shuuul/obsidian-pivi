# `src/features/` — Obsidian user-facing features

Feature/application layer for chat, settings, and inline edit. Features may use Obsidian UI APIs, shared widgets, utilities, pure helpers, and Pivi-owned Pi product services. Prefer explicit dependencies over implicit globals.

## Map

```mermaid
flowchart TD
  Chat["chat/<br/>sidebar sessions"] -- "Pi runtime/services" --> Pi["pi/"]
  Settings["settings<br/>PluginSettingTab"] -- "Pi workspace/settings" --> Pi
  Inline["inline-edit<br/>CodeMirror modal"] -- "Pi auxiliary service" --> Pi
  Chat -- "pure helpers/types" --> Core["core/"]
  Shared["../shared"] -- "widgets" --> Chat
  Shared -- "widgets" --> Settings
  Shared -- "widgets" --> Inline
```

## Rules

- Feature code owns UI composition and Obsidian interactions; low-level SDK work still belongs in Pi runtime/tool modules.
- Runtime/workspace dependencies should be explicit Pi services or callbacks supplied by the plugin/view/tab.
- Keep DOM cleanup and stale-tab guards close to the component/controller that registers async work.
