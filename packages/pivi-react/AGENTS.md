# `@pivi/pivi-react` package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package rules.*

## Purpose

This package is Pivi's React presentation boundary for chat, settings, and inline edit. It owns serializable UI models, Settings/InlineEdit presentation ports, stores, components, hooks, and deterministic mount/dispose APIs. Core owns runtime/application ports; Obsidian lifecycle shells and concrete service composition remain in `src/app`, while remaining product orchestration and imperative adapters remain in `src/ui`.

It also owns UI internationalization under `src/i18n/` and ordered CSS sources under `styles/`. App composition creates the shared translator; package React consumers access it only through `I18nProvider` / `useT()`.

## Dependency direction

- Depend only on React, ReactDOM, browser/CodeMirror APIs, injected presentation-platform capabilities, and non-engine host-neutral `@pivi/pivi-agent-core` contracts/models.
- Never import `obsidian` or another note-host SDK. Host apps implement `PresentationPlatform` and pass it to package mount APIs.
- Host-visible terminology is injected through `PresentationPlatform.getTerminology(locale)`. Product contracts and locale keys use `workspace` / `secureStorage`; never expose `vault`, `keychain`, `SecretStorage`, or a host brand as a React-port identifier.
- Never import `@/**`, `src/**`, app implementations, `@pivi/pivi-agent-core/engine/pi`, raw Pi SDKs, `@pivi/obsidian-host`, or `@pivi/obsidian-tools`.
- Define narrow Settings/InlineEdit presentation ports. Runtime/application `ChatPorts` remain in core; never accept a raw plugin object or recreate the broad `PiviPluginHost` contract.
- App adapters under `src/app/ui` are the only concrete port implementations and the only product layer that may call `mountChatView` / `mountSettings`. `mountInlineEdit` is package-internal: the CodeMirror `WidgetType` mounts/disposes it; the app adapter only supplies the port and owner realm.

## Ownership rules

- React is the sole DOM owner inside each mounted package root. `ImperativeChatAdapter` receives one empty portal container and exclusively owns only that container's children (tab runtime scaffolds + uncontrolled composer adapters). Product chrome inside portal slots is React-owned via `createPortal`.
- Every mount API returns a deterministic `dispose()` path. Resolve portals, ranges, timers, and event constructors from the supplied owner document/window.
- React snapshots must be immutable and serializable for structural inspection. Keep DOM nodes, Obsidian `Component`s, controllers, renderers, runtime services, subscriptions, and timers in app/runtime registries.
- Keep contenteditable composer DOM uncontrolled and preserve IME/cursor/token behavior through imperative refs/adapters.
- Obsidian Markdown and CodeMirror remain imperative adapters around isolated React-owned containers.
- Inline edit has a strict split: React owns the input, clarification reply, spinner, diff, accept/reject actions, reducer/controller, and `QueryBackedInlineEditService`; the CodeMirror adapter owns only an isolated React container plus decoration lifecycle.
- `mountInlineEdit` validates the supplied owner document/window, enforces the single active mount, and is disposed by the CM `WidgetType.destroy()` path. Package code must not call `Editor.replaceRange`, manipulate selection highlights, or import an Obsidian app/plugin.
- Chat shell presentation owns tabs, welcome/queue/todo/navigation status, messages, and composer toolbar chrome (model, mode, reasoning, external context, input usage meter, send/cancel). MCP servers are managed in Settings (no composer toolbar picker). Application-facing `ChatPorts` are owned by `@pivi/pivi-agent-core/runtime/chatPorts` and captured by an app-owned adapter closure; `mountChatView` and its `ImperativeChatAdapter` contract never import, receive, or forward them. `ChatShell` consumes snapshots/actions and has no runtime-port context. Live chrome/message/composer state reaches React through `ActiveChatUiBridge` + immutable `ChatUiStore` snapshots. The `src/ui/chat` `TabManager` receives `ChatPorts` from app wiring and uses `ports.catalog` / `ports.models` / `ports.settings` / `ports.runtime` / `ports.sessions`; app wiring adapts facades into those narrow methods and never passes the facade object to runtime. Bridge portal elements remain runtime-only and outside snapshots. The uncontrolled rich input, composer context chips, and cursor-relative mention/slash adapters remain imperative islands.
- Mention parsing and token normalization live in `@pivi/pivi-agent-core/context/mentions`; this package owns only the context-badge presentation model, labels, icons, and rendering contracts under the `context-badges` subpath.
- Composer context-length meter (`UsageMeter` in `ChatShell`) is **input-only**: one ring for `inputTokens / contextWindow` via core `calculateInputUsagePercentage`. There is no output ring. Tooltip / aria labels use the React-owned compact formatter in `src/usage/usageInfo.ts` (e.g. `900`, `1k`, `12k`, `3.4m`).
- Public presentation seams used by `src/ui` are the exact `store`, `inline-edit`, and `context-badges` subpaths. Do not re-export pure parsers, runtime/application ports, usage projection, or domain matching from the React root.
- Composer toolbar keeps stable model/thinking trigger widths via longest-label sizers; external-context uses the compact btn+count trigger. Toolbar menus raise `.pivi-input-container` above the floating tab switcher.
- Chat messages are snapshot-driven React components. Obsidian Markdown, rich tool/diff bodies, ask-user interaction, and stored nested subagents mount only through generation-guarded owner-realm adapter slots.
- Tool shells consume `@pivi/pivi-agent-core/tools/toolPresentation` for canonical kind, icon, title token, summary, visibility, and grouping. `chat/messages/toolPresentation.ts` may translate tokens and group React rows, but must not define tool-ID maps or duplicate summary rules.
- Settings are fully React-owned. `SettingsRoot` consumes only `SettingsPorts`; no Obsidian `Setting`, modal manager, raw workspace, storage, process, or plugin object may cross that boundary. Note-host tool rows and integration actions arrive as host-provided descriptors (`listToolRows` / `hostIntegrations`), so product React does not enumerate Obsidian tools or construct Note Toolbar / Style Settings behavior.
- Settings rows, toggles, modal layers, buttons, and icon wrappers use package-owned `.pivi-*` classes and styles. Do not emit or target a note-host's structural classes such as `setting-item`, `checkbox-container`, `modal-*`, `mod-*`, or `svg-icon`.
- React-owned DOM and CSS use `pivi-*` classes exclusively. Do not depend on host-global classes such as `setting-item*`, `modal*`, `checkbox-container`, `mod-cta`, `mod-warning`, `theme-*`, or `svg-icon`; host theme integration is limited to the `--pivi-host-*` token contract.

## Verification

Run the root boundary check, typecheck, lint, tests, and build. React behavior tests belong to the `pivi-react` jsdom Jest project under `tests/pivi-react/`.
- Inline-edit tests must exercise user-visible state transitions and CM widget mount/dispose with a non-default owner realm.
