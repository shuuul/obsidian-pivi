# `src/app/` — product composition shell

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first.*

## Purpose

`src/app/` is the Obsidian product composition layer: lifecycle, command/view registration, settings codecs, host contracts, and Pi workspace service construction. It sits between the thin `src/main.ts` Plugin shell and product UI.

## Dependency direction

```mermaid
flowchart LR
  Main["src/main.ts"] --> App["src/app"]
  App --> AppUI["src/app/ui<br/>concrete wiring + lifecycle hosts"]
  AppUI --> UI["src/ui<br/>orchestration + imperative adapters"]
  AppUI --> ReactUI["@pivi/pivi-react<br/>React presentation"]
  AppUI --> Runtime["core/runtime<br/>application ChatPorts"]
  App --> Host["@pivi/obsidian-host"]
  App --> Engine["@pivi/pivi-agent-core/engine/pi"]
  App --> Tools["@pivi/obsidian-tools"]
  UI -. "type-only host contracts" .-> App
  AppUI -. "injects ChatPorts + runtime services" .-> UI
  UI --> Runtime
  UI --> Platform["@/app/hostPlatform"]
  Platform --> Host
```

## Rules

- **Construct concrete Pi runtime here.** `workspace/createChatRuntimeServices.ts` builds `PiChatRuntime` and Pi aux runners. Keep their factories on workspace services and the app-only `ChatUiCompositionHost` wiring surface; product UI receives them only through core-owned `ChatPorts` / `PiChatService` / `AuxQueryRunner` contracts.
- **Register before workspace I/O.** `pluginLifecycle` registers views, commands, and settings after required settings load, then starts the single-flight `ensureWorkspaceServices()` from a visible surface or `workspace.onLayoutReady`. View/settings hosts await the same promise before building ports, and generation guards prevent late mounts after close/hide. Workspace disposal owns MCP OAuth and provider/connection-pool shutdown.
- **Hide engine/pi and facades from product UI.** `workspace/piUiFacades.ts` wraps chat UI config, settings projection, model catalog listing, and keychain migration. `src/app/ui/createUiPorts.ts` is the chat wiring boundary that adapts facade behavior into narrow core-owned `ChatPorts`; `src/ui/**` never calls `getUiFacades()` or imports `engine/pi`.
- **Host contracts without concrete implementations.** `hostContracts.ts` defines the semantic `PiviChatViewHandle`, structural `PiviChatView`, app-only `PiviChatHost`, composition-only `PiviChatCompositionHost`, `PiviSettingsHost`, `PiviPluginWorkspace`, and `PiviPluginHost`. Do not import concrete `PiviViewHost`, `src/app/workspace/**`, or `@pivi/pivi-agent-core/engine/pi/**` into host contracts.
- **UI uses `hostPlatform` for path/vault/CLI helpers.** Never import `@pivi/obsidian-host` from `src/ui/**` (enforced by architecture + ESLint).
- **`workspace/**` must not import `@/ui/**`.** React settings consume package-owned ports implemented in `src/app/ui/createUiPorts.ts`; workspace services expose runtime capabilities only.
- **`ui/**` is the package-port adapter and Obsidian lifecycle-host layer.** It is the only product directory that imports `@pivi/pivi-react/ports` and `@pivi/pivi-react/mount`; application-facing `ChatPorts` come from `@pivi/pivi-agent-core/runtime/chatPorts`. `PiviViewHost` stays a thin Obsidian view lifecycle shell: create ports, resolve presentation-only scalars such as the chat icon, prepare the React shell, mount, dispose. Its app-local imperative adapter wrapper captures `ChatPorts`; the React mount contract never imports, receives, or forwards them. `createImperativeChatAdapter` owns the aggregate mount/lifecycle and semantic translation boundary; tab runtime and message-presentation implementations remain in `src/ui/chat`. The adapter is the only app-side boundary allowed to inspect the internal `TabManager` / `TabData` / controller / UI / DOM aggregate; every other app caller uses `PiviChatViewHandle.commands` or `.maintenance`. `createChatUiPorts` builds `ChatPorts` (`runtime` / `sessions` / `catalog` / `models` / `settings`) and adapts facade-backed application behavior without exposing the facade; `createSettingsUiPorts` implements React-owned `SettingsPorts`. Do not inject a settings renderer into the service graph—settings mount only through `PiviSettingTabHost` + `SettingsPorts`. Chat chrome reaches React through `ActiveChatUiBridge` + `ChatUiStore` snapshots; ports supply catalogs/factories/configuration, not live UI state or facade objects. MCP `save`/`reload` invalidate slash caches, warm `PiMcpToolProvider` tool lists, and reload chat-runtime MCP bridges (which prefetch enabled tools into the bridge cache).
- **Keep runtime and composition hosts distinct.** `PiviChatHost` exposes only `app` to `src/ui/chat`; all runtime/session/model/catalog/settings behavior arrives through `ChatPorts`. `PiviChatCompositionHost` owns settings, facades, view enumeration, and tab-state persistence for `src/app/ui` and the plugin shell. Settings ports use `PiviSettingsHost`. Only `PluginSettingTab` subclasses (and app composition) use full `PiviPluginHost` when Obsidian requires a `Plugin`. Both `createChatUiPorts(host, workspace)` and `createSettingsUiPorts(host, workspace)` receive an explicit workspace from composition. `PiviViewHost` and `PiviSettingTabHost` each receive a lazy `getWorkspace` callback from registration so construction does not capture an uninitialized workspace.
- **Use semantic view operations from app code.** Commands and maintenance flows obtain `PiviChatViewHandle` from the structural view, then call behavior-named operations. Never expose or down-drill through `TabManager`, `TabData`, `.controllers`, `.ui`, `inlineContextManager`, `externalContextSelector`, or other DOM/runtime surfaces outside `imperativeChatAdapter.ts`.
- Keep session load/delete/purge helpers in `pluginSessionApi.ts` and settings load in `pluginSettingsLoad.ts` so `main.ts` stays a thin composition root.

## Key files

| File | Role |
|------|------|
| `hostContracts.ts` | Semantic `PiviChatViewHandle`, structural view, runtime/composition Chat hosts, Settings/Plugin host surfaces |
| `hostPlatform.ts` | Path, vault notify, CLI flags, service-contract re-exports for UI |
| `pluginSessionApi.ts` | Session CRUD / purge; cross-view resets and protected bindings use semantic view maintenance |
| `pluginSettingsLoad.ts` | Settings load, keychain migration, skills seed |
| `noteToolbarIntegration.ts` | Safe Note Toolbar detection, install/enable fallback, official CLI command-item setup, and single-flight setup queue |
| `openStyleSettings.ts` | Style Settings tab open or marketplace fallback |
| `piviViewActivation.ts` | Activate/open Pivi leaves and create tabs without stacking a blank cold-open tab |
| `serviceGraph.ts` | Builds the Pi workspace from an explicit narrow app host; asserts bundled React runtime |
| `ui/obsidianPresentationPlatform.ts` | Obsidian implementation of the product React icon/tooltip platform seam |
| `ui/obsidianSettingsIntegration.ts` | Obsidian tool-row and settings-integration descriptors injected into generic product React settings |
| `ui/PiviViewHost.ts` | Thin Obsidian chat view lifecycle; mounts React chat; receives `getWorkspace` from registration for `createChatUiPorts` |
| `ui/imperativeChatAdapter.ts` | Sole internal aggregate boundary: TabManager mount/lifecycle, semantic view handle, and tabs-store/message-adapter bridge into `src/ui/chat` |
| `ui/externalDirectory.ts` | Desktop directory pick/validate for settings ports (no `@/ui` import) |
| `ui/PiviSettingTabHost.ts` | Obsidian settings tab lifecycle; mounts React `SettingsRoot` only |
| `ui/createUiPorts.ts` | Explicit-workspace `createChatUiPorts(host, workspace)` and `createSettingsUiPorts(host, workspace)` public entries |
| `ui/createUiPortHelpers.ts` | Shared workspace/env/subagent helpers for UI port adapters |
| `ui/createSettingsModelsPort.ts` | Settings models/credential port wiring |
| `ui/createMcpSettingsPorts.ts` | Settings MCP save/reload/auth port wiring |
| `workspace/PiWorkspaceServices.ts` | MCP, skills, tools, readiness, chat factories |
| `workspace/createChatRuntimeServices.ts` | `PiChatRuntime` / aux-query construction only |
| `workspace/piUiFacades.ts` | Settings/model/auth facades for product UI |
| `commandRegistration.ts` / `viewRegistration.ts` / `settingsRegistration.ts` | App → UI mount points |
