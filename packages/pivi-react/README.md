# @pivi/pivi-react

## Purpose

`@pivi/pivi-react` owns Pivi's reusable product presentation for chat, settings, and inline edit. It follows the Pivi/AI product rather than a specific note-taking host. React and ReactDOM are supplied by the embedding application.

## Allowed dependencies

- React and ReactDOM peer runtimes.
- Browser DOM and CodeMirror state/view APIs resolved from each surface's owning document and window.
- Bundled provider icon data from `@lobehub/icons-static-svg`.
- Host-neutral, non-engine contracts and display models from `@pivi/pivi-agent-core`.
- An injected `PresentationPlatform` for icon and tooltip behavior, plus host-provided tool and integration descriptors for settings.

## Forbidden dependencies

- Product code under `src/**` or the `@/**` alias.
- Raw `@earendil-works/*` Pi SDK packages.
- `@pivi/pivi-agent-core/engine/pi` implementations.
- `@pivi/obsidian-host` concrete host adapters.
- `@pivi/obsidian-tools` concrete tool implementations.
- Obsidian or another note-host SDK.
- Electron and Node-only APIs.

## Public API

- `createI18n()`, `I18nProvider`, and `useT()` provide one app-owned translator to imperative and React surfaces.
- The `/context-badges` view-model builder requires that translator; it localizes tooltip and accessibility copy while preserving tool, MCP, skill, agent, path, and range identifiers.
- Feature-specific settings and inline-edit presentation ports are exported from `@pivi/pivi-react/ports`; only `src/app/ui` implements them. Application-facing chat ports come from `@pivi/pivi-agent-core/runtime/chatPorts`.
- `mountChatView()` and `mountSettings()` receive a `PresentationPlatform`, create one deterministic React root per surface, and return an idempotent async `dispose()` handle.
- Settings render host-provided tool rows and integration sections; Obsidian CLI, Note Toolbar, and Style Settings behavior stays in the embedding app adapter.
- `ChatUiStore`, `useChatUiSnapshot()`, and the pure exhaustive stream reducer are exported from `@pivi/pivi-react/store`. Store snapshots are deeply immutable, structurally cloneable data and exclude DOM nodes, controllers, renderers, runtime services, subscriptions, and timer handles.
- `ChatTabsStore` drives the React-owned chat header, logo, and tab switcher. Input-position rendering uses one stable app-owned portal container so active-tab switches do not remount the React subtree or cancel pending interactions.
- The package root exports general presentation components and i18n. Public subpaths are `/context-badges`, `/inline-edit`, `/mount`, `/ports`, `/settings`, and `/store`; `src/ui` is limited to the store, inline-edit, and context-badges presentation seams.
- `styles/manifest.mjs` is the ordered source manifest used to build the root `styles.css` release artifact.
- Chat messages, settings, and inline edit are React-owned. Core owns runtime/application ports; each host app owns concrete wiring and host-specific Markdown/editor adapters.

## See also

See [AGENTS.md](AGENTS.md) for package-local development and boundary guidance.
