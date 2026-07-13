*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these local rules.*

# Product UI

## Purpose

`src/ui/` owns chat runtime orchestration, reusable imperative UI primitives, and the inline-edit CodeMirror adapter. React owns product chrome for chat, settings, and inline edit in `@pivi/obsidian-ui`; this layer keeps only runtime coordination and Obsidian/CodeMirror adapters that cannot live in the host-neutral React package.

## Architecture

`src/main.ts` and `src/app/` compose Obsidian lifecycle shells and package-owned feature ports. `src/ui/` retains runtime orchestration and the imperative Obsidian/CodeMirror adapters that cannot live in the host-neutral React package.

```mermaid
flowchart TD
  Main["src/main.ts"] --> App["src/app composition"]
  App --> ReactUI["@pivi/obsidian-ui React roots"]
  App --> Chat["src/ui/chat runtime + adapters"]
  App --> Inline["src/ui/inline-edit CM adapter"]
  App -- "SettingsPorts" --> ReactUI
  App -- "ChatPorts + mount" --> ReactUI
  App -- "ChatPorts via TabManager" --> Chat
  App -- "InlineEditPort" --> Inline
  Chat -- "ChatUiStore snapshots + ActiveChatUiBridge" --> ReactUI
  ReactUI -- "empty adapter slots" --> Chat
  Inline -- "CM widget container" --> ReactUI
  Chat --> Runtime["@pivi/pivi-agent-core/runtime"]
  Inline --> Runtime
  Chat --> Shared["src/ui/shared imperative helpers"]
  Inline --> Shared
```

`src/app/ui/PiviViewHost` owns the Obsidian view lifecycle and mounts the package React root. `createImperativeChatAdapter` owns tab runtime + message presentation adapters. Chat product chrome is React-owned; `src/ui/chat` retains service orchestration and explicit content adapters only—never import `@/app/ui/**` from here. React settings live entirely in `@pivi/obsidian-ui` and consume app-owned `SettingsPorts`. Inline edit is a React-owned CodeMirror widget backed by an injected `AuxQueryRunner`.

## Subdirectory map

| Path | Responsibility | Local guidance |
|---|---|---|
| `src/ui/chat/` | Tab/session lifecycle, service orchestration, stream projection, and imperative Markdown/tool content adapters beneath the React shell | `src/ui/chat/AGENTS.md` |
| `src/ui/shared/` | Cross-feature imperative Obsidian/CodeMirror adapters and path helpers | `src/ui/shared/AGENTS.md` |
| `src/ui/inline-edit/` | App-side CodeMirror/Obsidian adapter for the package React inline-edit widget | `src/ui/inline-edit/AGENTS.md` |

Read the applicable child `AGENTS.md` before changing a subdirectory.

## Boundary rules

- Never import raw `@earendil-works/*` packages. Pi SDK use belongs under `packages/pivi-agent-core/src/engine/pi/`.
- Never import `@pivi/pivi-agent-core/engine/pi` or its subpaths. Obtain concrete behavior through `plugin.createChatService()`, `plugin.createAuxQueryRunner()`, and `plugin.getUiFacades()`.
- Never import `@pivi/obsidian-host` or its subpaths. Import platform/path/vault helpers and service-contract re-exports through `@/app/hostPlatform`.
- Never import `@pivi/obsidian-tools`; UI consumes Pivi tool contracts/display models, not concrete tool implementations.
- Never import `@/app/workspace` or its subpaths, including via relative paths. Never call `getPiWorkspace()` from `src/ui/**`. Reach workspace capabilities through narrow host methods and `ChatPorts` injected into `TabManager` (`catalog` / `models` / `runtime` / `sessions`).
- Never import `@/app/ui` or its subpaths from `src/ui/**`. App composition mounts React and creates adapters; this layer is imperative adapters + runtime orchestration only.
- Prefer `PiviChatHost` or `PiviSettingsHost`; use `PiviPluginHost` only when an Obsidian base class requires the actual `Plugin` surface.
- UI may import host-neutral APIs from non-engine `@pivi/pivi-agent-core/*` subpaths and public Obsidian APIs. Keep app/UI composition one-way: app mounts UI; UI only type-depends on host contracts.

## Key conventions

- `src/ui/chat/tabs/tabRuntime.ts` is the sole UI creation point for chat services. Keep creation lazy and call `plugin.createChatService()`; never instantiate a runtime in UI.
- Use `PiChatService` for durable chat turn/session operations. Use a fresh injected `AuxQueryRunner` for short title, refine, or inline-edit queries that do not own a chat session lifecycle.
- Treat session files as durable identity and tab/controller/render state as rebuildable. Clean up services, subscriptions, event refs, managers, and CodeMirror decorations on close, replacement, hide, or failed initialization.
- Route model options, settings snapshots, custom-provider synchronization, model catalogs, and credential migration through `getUiFacades()` rather than duplicating engine policy.
- Put cross-feature primitives in `src/ui/shared/`; keep product behavior in the owning feature. Do not make shared helpers depend on chat/settings/inline-edit implementations.
- Use `PascalCase.ts` for primary UI classes/controllers/renderers/modals and `lowerCamelCase.ts` for helpers. Preserve existing import aliases and import sorting.
- Resolve document/window from the owning element (`getActiveDocument` / `getActiveWindow`) so pop-out windows work; avoid assuming global `window` or `document` for element-bound UI.

## i18n

- All user-visible copy—labels, descriptions, buttons, placeholders, Notices, empty states, aria labels, and tool display text—must use the shared `t()` from `@/app/i18n` for imperative adapters; React surfaces use `useT()` under `I18nProvider`.
- Add keys to canonical `packages/obsidian-ui/src/i18n/locales/en.json` and mirror the same key tree with translations in every other locale in the same change. Follow the package i18n guidance.
- Use sentence case. Technical identifiers, model/provider/tool IDs, brand identifiers, and raw user/agent content are exceptions.
- Locale controls plugin chrome only; do not use it to force the agent's response language.

## Gotchas

- Obsidian views can open in pop-outs and third-party plugins can patch view lifecycle/DOM. Preserve `PiviViewHost`'s Hover Editor guards, stable input-tab portal, and owner-document-aware event handling.
- Tabs can close during async service initialization. Re-check lifecycle state before publishing a service and clean up partially initialized subscriptions/services.
- Settings presentation is fully React-owned in `@pivi/obsidian-ui`; do not reintroduce imperative settings managers under `src/ui/`.
- Inline edit is single-active-controller state. Reject/clean the previous controller, use the editor passed to `editorCallback`, and keep IME composition guards.
- Do not expose API-transformed MCP prompt text in visible history: users see `@server`; runtime prompt finalization may send `@server MCP`.
- Avoid new `!important` styles and hard-coded English. CSS lives in `packages/obsidian-ui/styles/`, not beside these TypeScript modules.
