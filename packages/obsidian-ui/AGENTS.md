# `@pivi/obsidian-ui` package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package rules.*

## Purpose

This package is Pivi's React presentation boundary for chat, settings, and inline edit. It owns serializable UI models, feature-specific ports, stores, components, hooks, and deterministic mount/dispose APIs. Obsidian lifecycle shells and concrete service composition remain in `src/app`.

It also owns UI internationalization under `src/i18n/` and ordered CSS sources under `styles/`. App composition creates the shared translator; package React consumers access it only through `I18nProvider` / `useT()`.

## Dependency direction

- Depend only on React, ReactDOM, public Obsidian UI APIs, browser APIs, and non-engine host-neutral `@pivi/pivi-agent-core` contracts/models.
- Never import `@/**`, `src/**`, app implementations, `@pivi/pivi-agent-core/engine/pi`, raw Pi SDKs, `@pivi/obsidian-host`, or `@pivi/obsidian-tools`.
- Define narrow, feature-specific ports. Never accept a raw plugin object or recreate the broad `PiviPluginHost` contract.
- App adapters under `src/app/ui` are the only concrete port implementations and the only product layer that may call package mount APIs.

## Ownership rules

- React is the sole DOM owner inside each mounted package root. A remaining imperative chat adapter receives one empty portal container and exclusively owns only that container's children.
- Every mount API returns a deterministic `dispose()` path. Resolve portals, ranges, timers, and event constructors from the supplied owner document/window.
- React snapshots must be immutable and serializable for structural inspection. Keep DOM nodes, Obsidian `Component`s, controllers, renderers, runtime services, subscriptions, and timers in app/runtime registries.
- Keep contenteditable composer DOM uncontrolled and preserve IME/cursor/token behavior through imperative refs/adapters.
- Obsidian Markdown and CodeMirror remain imperative adapters around isolated React-owned containers.
- Inline edit has a strict split: React owns the input, clarification reply, spinner, diff, accept/reject actions, reducer/controller, and `QueryBackedInlineEditService`; the CodeMirror adapter owns only an isolated React container plus decoration lifecycle.
- `mountInlineEdit` validates the supplied owner document/window, enforces the single active mount, and is disposed by the CM `WidgetType.destroy()` path. Package code must not call `Editor.replaceRange`, manipulate selection highlights, or import an Obsidian app/plugin.
- Chat shell presentation owns tabs, welcome/queue/todo/navigation status, and composer toolbar chrome (model, mode, reasoning, external context, input usage meter, send/cancel). MCP servers are managed in Settings (no composer toolbar picker). Per-tab runtime state reaches it through `ActiveChatUiBridge`; bridge portal elements remain runtime-only and outside immutable snapshots. The uncontrolled rich input and cursor-relative mention/slash adapters remain imperative islands.
- Composer context-length meter (`UsageMeter` in `ChatShell`) is **input-only**: one ring for `inputTokens / contextWindow` via `calculateInputUsagePercentage`. There is no output ring. Tooltip / aria labels use compact lowercase token counts from `formatCompactTokenCount` in `src/usage/usageInfo.ts` (e.g. `900`, `1k`, `12k`, `3.4m`).
- Composer toolbar keeps stable model/thinking trigger widths via longest-label sizers; external-context uses the compact btn+count trigger. Toolbar menus raise `.pivi-input-container` above the floating tab switcher.
- Chat messages are snapshot-driven React components. Obsidian Markdown, rich tool/diff bodies, ask-user interaction, and stored nested subagents mount only through generation-guarded owner-realm adapter slots.
- Settings are fully React-owned. `SettingsRoot` consumes only `SettingsPorts`; no Obsidian `Setting`, modal manager, raw workspace, storage, process, or plugin object may cross that boundary.

## Verification

Run the root boundary check, typecheck, lint, tests, and build. React behavior tests belong to the `obsidian-ui` jsdom Jest project under `tests/obsidian-ui/`.
- Inline-edit tests must exercise user-visible state transitions and CM widget mount/dispose with a non-default owner realm.
