# @pivi/obsidian-react

## Purpose

`@pivi/obsidian-react` owns reusable React presentation for Pivi's Obsidian surfaces. React and ReactDOM are bundled with the plugin; this package never assumes that Obsidian provides a compatible React runtime.

## Allowed dependencies

- React and ReactDOM.
- Public Obsidian UI APIs required by presentation adapters.
- Browser DOM APIs resolved from each surface's owning document and window.
- Host-neutral, non-engine contracts and display models from `@pivi/pivi-agent-core`.

## Forbidden dependencies

- Product code under `src/**` or the `@/**` alias.
- Raw `@earendil-works/*` Pi SDK packages.
- `@pivi/pivi-agent-core/engine/pi` implementations.
- `@pivi/obsidian-host` concrete host adapters.
- `@pivi/obsidian-tools` concrete tool implementations.
- Electron and Node-only APIs.

## Public API

- `createI18n()`, `I18nProvider`, and `useT()` provide one app-owned translator to imperative and React surfaces.
- Feature-specific settings and inline-edit presentation ports are exported from `@pivi/obsidian-react/ports`; only `src/app/ui` implements them. Application-facing chat ports come from `@pivi/pivi-agent-core/runtime/chatPorts`.
- `mountChatView()` and `mountSettings()` create one deterministic React root per surface and return an idempotent async `dispose()` handle.
- `ChatUiStore`, `useChatUiSnapshot()`, and the pure exhaustive stream reducer are exported from `@pivi/obsidian-react/store`. Store snapshots are deeply immutable, structurally cloneable data and exclude DOM nodes, controllers, renderers, runtime services, subscriptions, and timer handles.
- `ChatTabsStore` drives the React-owned chat header, logo, and tab switcher. Input-position rendering uses one stable app-owned portal container so active-tab switches do not remount the React subtree or cancel pending interactions.
- The package root exports general presentation components and i18n. Use the explicit `/mount`, `/ports`, `/store`, `/inline-edit`, and `/context-badges` subpaths for those contracts; `src/ui` is limited to the latter three presentation seams.
- `styles/manifest.mjs` is the ordered source manifest used to build the root `styles.css` release artifact.
- Chat messages, settings, and inline edit are React-owned. Core owns runtime/application ports, app owns concrete wiring, and `src/ui` owns remaining product orchestration plus isolated imperative adapters for Obsidian Markdown, rich tool/diff bodies, stored nested subagents, uncontrolled contenteditable, and CodeMirror decorations.

## See also

See [AGENTS.md](AGENTS.md) for package-local development and boundary guidance.
