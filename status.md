# React migration status

Last updated: 2026-07-12

## Invariants

- Preserve user-visible behavior while changing ownership from imperative DOM to React.
- Establish boundaries in this order: package boundary → ports → root lifecycle → state separation → React presentation → remove imperative DOM.
- Keep `src/app` as the only composition layer for runtime, host, tools, and UI.
- Keep the release artifact set to `main.js`, `manifest.json`, and `styles.css`.
- Bundle exactly one React runtime and dispose every React root deterministically.

## Progress

| Phase | Status | Notes |
|---|---|---|
| 0. Behavioral baseline | Complete | Baseline and bundle composition recorded; lifecycle/streaming/DOM/IME characterization coverage added. |
| 1. Package and toolchain | Complete | UI workspace package, TSX, React linting, jsdom Testing Library project, boundary rules, and bundled production React runtime are green. |
| 2. i18n, styles, shared logic | Complete | Shared translator/catalogs, ordered CSS manifest, mention parsing/tokens, context badge models, fuzzy scoring, streaming math, usage calculations, and pure diff now live in the UI package. |
| 3. UI ports and app adapters | Complete | Feature ports are package-owned; `src/app/ui` is the sole implementation/mount layer; misplaced host service contracts were split by ownership. |
| 4. React root lifecycle | Complete | Chat and settings lifecycle hosts create one React root, pass owner realm/portal context, and dispose deterministically. |
| 5. Store and runtime registry | Complete | Immutable/serializable snapshots, `useSyncExternalStore`, runtime-only state split, tab registry, and exhaustive pure stream projection are integrated. |
| 6. Chat vertical slices | Complete | Shell/tabs, status/navigation, composer/toolbar, messages, and live streaming are React-owned. |
| 7. Settings | Complete | All settings pages and dialogs are React-owned behind narrow package ports; imperative renderers/managers were deleted. |
| 8. Inline edit | Complete | React owns input, clarification, diff, actions, and state; CodeMirror retains only the widget/decorations adapter. |
| 9. Legacy removal and final boundaries | Complete | Legacy surfaces, hidden stream DOM, obsolete UI owners, compatibility names, probes, and no-op stream wrappers were removed. |

## Phase 0 baseline

### Verification

| Command | Result | Notes |
|---|---|---|
| `npm ci` | Passed | 918 packages installed; 0 vulnerabilities. |
| `npm run check:boundaries` | Passed | 1.44 s. |
| `npm run typecheck` | Passed | 2.58 s. |
| `npm run lint` | Passed | 14.07 s. |
| `npm run test -- --runInBand` | Passed | 160 suites, 1,178 tests; 8.10 s wall time. |
| `npm run build` | Passed | 0.63 s; deployed the three release artifacts to the configured vault. |
| `npm run analyze:bundle` | Passed | 0.38 s; wrote `metafile.json`. |

### Bundle baseline

- `main.js`: 3,162,345 bytes on disk (metafile output: 3,162,344 bytes).
- `styles.css`: 116,147 bytes on disk.

Largest source/dependency groups by esbuild `bytesInOutput`:

| Group | Bytes | Share of `main.js` |
|---|---:|---:|
| `src/i18n` | 504,107 | 15.94% |
| `src/ui` | 483,729 | 15.30% |
| `@earendil-works/pi-ai` | 297,159 | 9.40% |
| `@google/genai` | 284,416 | 8.99% |
| `packages/pivi-agent-core` | 229,336 | 7.25% |
| `@modelcontextprotocol/sdk` | 180,098 | 5.70% |
| `typebox` | 139,771 | 4.42% |
| `ajv-formats` | 117,263 | 3.71% |
| `yaml` | 115,640 | 3.66% |
| `google-auth-library` | 110,686 | 3.50% |

Largest individual inputs:

| Input | Bytes | Share of `main.js` |
|---|---:|---:|
| `@google/genai/dist/node/index.mjs` | 284,416 | 8.99% |
| `src/i18n/locales/ru.json` | 111,042 | 3.51% |
| `@earendil-works/pi-ai/dist/providers/openrouter.models.js` | 96,573 | 3.05% |
| `src/i18n/locales/ja.json` | 67,070 | 2.12% |
| `web-streams-polyfill/dist/ponyfill.es2018.js` | 61,206 | 1.94% |
| `src/i18n/locales/ko.json` | 55,053 | 1.74% |

### Characterization coverage

- [x] `blank → bound_cold → bound_active → closing`
- [x] lazy service initialization on first send
- [x] tab close vs asynchronous initialization race
- [x] session load, fork, and redo
- [x] queued turn
- [x] cancellation
- [x] repeated incremental `tool_use`
- [x] message content block ordering
- [x] stale Markdown render protection
- [x] popout `ownerDocument`
- [x] IME composition

## Phase 1 result

- Added workspace package `@pivi/obsidian-ui` with package-local dependency guidance and public entry point.
- Added React 19, ReactDOM, types, React hooks lint rules, TSX compilation, and `{ts,tsx}` lint/coverage globs.
- Added a dedicated jsdom Jest project with Testing Library while preserving the Node unit/integration projects.
- Architecture checks reject `@/`, `src/**`, engine/pi, concrete host/tools, and raw Pi SDK imports from the UI package.
- React and ReactDOM are bundled rather than externalized; production analysis contains only production React runtime modules.
- App composition imports the package successfully; the probe remains test-only and no product UI has been replaced.

### Phase 1 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | UI package rules and README coverage included. |
| `npm run typecheck` | Passed | Source and tests, including TSX. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 164 suites, 1,190 tests across 3 projects. |
| `npm run build` | Passed | Three release artifacts preserved. |
| `npm run analyze:bundle` | Passed | `main.js` 3,359,265 bytes after production React bundling. |

Production React inputs total 189,655 bytes; only production variants are present (`react.production`, `react-dom.production`, `react-dom-client.production`, and JSX runtime wrappers).

## Phase 2 result

- Moved the locale runtime and all locale JSON catalogs from `src/i18n/` to `packages/obsidian-ui/src/i18n/`.
- Added `createI18n()`, `I18nProvider`, and `useT()`; app composition owns one translator shared by commands, views, settings, legacy UI, and future React roots.
- Moved all CSS source modules to `packages/obsidian-ui/styles/`; `scripts/build-css.mjs` consumes the package manifest while preserving root artifact order and content.
- Moved dependency-light shared logic into the package: mention parsing and path/token normalization, context badge labels/view models, fuzzy matching, streaming math helpers, usage calculations, and word diff.
- Legacy UI retains only DOM, Obsidian Markdown, and CodeMirror presentation adapters around those package APIs.
- Package sources contain no `@/` or `src/**` imports.

### Phase 2 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | UI package dependency rules and package docs passed. |
| `npm run typecheck` | Passed | Source and tests. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 164 suites, 1,194 tests across 3 projects. |
| `npm run build` | Passed | Release artifact set remains `main.js`, `manifest.json`, and `styles.css`. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,359,400 bytes. |

- `styles.css`: 116,147 bytes; SHA-256 `260b12edba2559397ef2bc79ad4657d14900b1a97fb6042b0c31cbe984486203` (identical to baseline).
- Locale key parity and package React-provider tests pass in the jsdom project.

## Phase 3 result

- Added feature-specific chat runtime/session/catalog/configuration ports, settings persistence/environment/catalog ports, and an inline-edit runner port under `@pivi/obsidian-ui/ports`.
- Added the only concrete port adapters under `src/app/ui`; returned port objects expose neither a plugin/workspace service locator nor raw storage, HTTP, or process-runner objects.
- Deleted `packages/obsidian-host/src/serviceContracts.ts`:
  - MCP contracts now live in `@pivi/pivi-agent-core/mcp/ports`.
  - model readiness contracts live in `@pivi/pivi-agent-core/foundation/modelReadiness`.
  - skill inventory contracts live in `@pivi/pivi-agent-core/skills/skillProvider`.
  - workspace initialization remains in `src/app/workspace/serviceContracts.ts`.
  - the legacy settings renderer remains in app host contracts with an explicit Phase 7 deletion marker.
- Architecture and ESLint rules reject port or mount imports outside `src/app/ui`.

### Phase 3 verification

- Full checks passed: 165 suites / 1,196 tests, boundaries, typecheck, lint, and production build.
- Adapter tests verify delegation and absence of raw plugin/workspace/storage fields.

## Phase 4 result

- Added deterministic package mount APIs `mountChatView()` and `mountSettings()`.
- Added direct Obsidian lifecycle hosts `PiviViewHost extends ItemView` and `PiviSettingTabHost extends PluginSettingTab` under `src/app/ui`.
- Moved the existing imperative chat/settings presentation behind one `LegacySurfaceAdapter` container per React root; React does not render children inside the legacy-owned region after mount.
- `onClose()` / `hide()` invoke idempotent disposal; chat tabs, renderers, event refs, managers, and the React root are cleaned through one path.
- Owner document, owner window, and portal container are supplied from each actual host container. A jsdom iframe test covers the popout realm path.

### Phase 4 verification

- Full checks passed: 166 suites / 1,198 tests, boundaries, typecheck, lint, production build, and bundle analysis.
- `obsidian plugin:reload id=pivi` passed.
- Obsidian CLI smoke: opening Pivi produced one `chat` React surface, retained the legacy child tree, matched the owner document, and filled the 909 px host height.
- `obsidian dev:errors` showed no Pivi/React error after reload/open; the only captured stack was an unrelated Obsidian CodeMirror/Templater tokenizer error.
- Current artifacts: `main.js` 3,363,794 bytes; `styles.css` 116,233 bytes.

## Phase 5 result

- Added package-owned `ChatUiStore`, deeply immutable `ChatUiSnapshot`, and `useChatUiSnapshot()` external-store hook.
- Snapshot cloning rejects DOM nodes, class instances, functions, services, controllers, renderers, subscriptions, and timers while accepting plain objects created in popout/Jest VM realms.
- Split legacy `ChatStateData` from `ChatRuntimeStateData`; DOM references, thinking renderer state, tool element maps, write/edit renderer state, pending DOM tools, grouped-tool renderers, and timer handles remain runtime-only.
- Existing `ChatState` callbacks now flow through store subscriptions without changing callback behavior.
- Added `TabRuntimeRegistry` as the explicit owner of rebuildable tab runtime aggregates; persisted tab state remains separate.
- Added an exhaustive pure stream reducer for text, thinking, repeated incremental tool use, tool output/results, usage, notices/errors, compaction, and subagent chunks. `StreamController` projects each chunk into the React snapshot before legacy DOM side effects execute in arrival order.

### Phase 5 verification

- Full checks passed: 169 suites / 1,210 tests, boundaries, typecheck, lint, production build, and bundle analysis.
- Store tests verify structural cloning, deep immutability, forbidden runtime fields, stable untouched branches, and React subscription behavior.
- Reducer tests cover every `StreamChunk` variant, ordering boundaries, blocked status, repeated tool input merge, nested subagent tools, and input immutability.
- `obsidian plugin:reload id=pivi` passed.
- Current artifacts: `main.js` 3,371,167 bytes; `styles.css` 116,233 bytes.

## Phase 6.1 result — shell and tabs

- Moved chat header, Pivi/provider logo, active title, and tab switcher into the existing single `@pivi/obsidian-ui` React root.
- Added immutable `ChatTabsSnapshot`, `ChatTabsStore`, and narrow async tab actions for switch, archive/restore, rename, close, and create.
- Both configured positions are supported without a second root:
  - header mode renders inside the React-owned header;
  - input mode uses a portal into one stable app-owned container that `PiviViewHost` moves between active tabs.
- The stable portal identity is required: active close/archive switches to a fallback immediately, then commits after the 200 ms exit animation. Remounting the portal subtree would cancel that timer.
- Preserved active, archived, streaming, attention, close availability, title-direction animation, menu close animation, archived reveal resistance, keyboard focus/Escape, edit caret/cancellation, Obsidian tooltips/icons, and popout owner-realm behavior.
- Deleted the imperative `src/ui/chat/tabs/TabBar.ts` and its mock-DOM suite. Equivalent React characterization coverage now lives in `tests/obsidian-ui/ChatShell.test.tsx`; listener-accumulation/manual-reconciliation tests were intentionally not ported because React owns those guarantees.
- Updated package and legacy UI guidance to reflect that React owns shell/tabs while the remaining tab content is still one isolated legacy island.
- Repaired the tab-switcher regression: menu actions alone use the hidden/floating action class; the new-chat control remains in grid flow, and input-mode bottom controls now align their stable portal at the right edge.

### Phase 6.1 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | UI package and app-only mount/port boundaries remain green. |
| `npm run typecheck` | Passed | Source and tests. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 169 suites, 1,201 tests across 3 projects. |
| `npm run build` | Passed | Release artifacts copied to the configured vault. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,367,806 bytes on disk. |
| `obsidian plugin:reload id=pivi` | Passed | Reloaded after production build. |

- `styles.css`: 116,258 bytes.
- Obsidian smoke test passed: exactly one chat React root; both header and input positions display a visible, clickable icon-bearing new-chat button; the input control’s right edge matches its active bottom-controls container; no captured Pivi/React error.

## Phase 6.2 result — status and navigation

- Added `ActiveChatUiBridge`, which selects the active tab’s immutable `ChatUiStore` while keeping five React-exclusive portal elements outside serializable snapshots.
- Moved welcome/greeting, queued-turn actions, input/output usage gauges, persistent todo status, navigation controls, and auto-scroll recovery into the existing single React chat root.
- Kept `QuoteBackgroundController` as an owner-realm imperative adapter inside one empty React-owned container; keyboard navigation and stream scroll scheduling remain behavior-only imperative services.
- Deleted the replaced `ComposerQueueIndicator`, `NavigationSidebar`, `ContextUsageMeter`, `StatusPanel`, and persistent `TodoVisualizationPanel` DOM owners, their runtime fields, and obsolete DOM-focused tests.
- Added full locale parity for queue, usage, todo, and auto-scroll text. Mount failures now dispose partially initialized legacy surfaces before unmounting React.

### Phase 6.2 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | Package/app boundaries and package README coverage remain green. |
| `npm run typecheck` | Passed | Source and tests. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 167 suites, 1,199 tests across 3 projects. |
| `npm run build` | Passed | Release artifacts deployed to the configured vault. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,362,254 bytes on disk. |
| `obsidian plugin:reload id=pivi` | Passed | Reloaded after production build. |

- `styles.css`: 115,747 bytes.
- Live Obsidian smoke: one React chat root; welcome greeting and quote layer rendered; queue/usage/todo/navigation portals projected injected active-tab state; auto-scroll recovery updated state; no captured runtime errors.

## Phase 6.3 result — composer and toolbar

- Added serializable per-tab composer snapshots and narrow runtime actions for model, mode, adaptive reasoning, external context, MCP, and send/cancel state.
- React now owns toolbar chrome in the existing root, including localized selectors, external/MCP dropdowns, OAuth/probe/settings actions, and disabled/send/stop transitions.
- Refactored external-context and MCP selectors into DOM-free runtime models while preserving pinned/session paths, mentioned servers, recovery, OAuth, probe, and settings behavior.
- Kept `RichChatInput`, file/image/inline context managers, selection controllers, and cursor-relative mention/slash dropdowns as explicit imperative adapters; React does not reconcile their children.
- Deleted imperative `InputToolbar`, model/mode/thinking selectors, and `InputSendButton` owners plus obsolete fields and calls.

### Phase 6.3 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | Package/app dependency boundaries remain green. |
| `npm run typecheck` | Passed | Source and tests. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 167 suites, 1,200 tests across 3 projects. |
| `npm run build` | Passed | Release artifacts deployed to the configured vault. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,352,743 bytes on disk. |
| `obsidian plugin:reload id=pivi` | Passed | Reloaded after production build. |

- `styles.css`: 115,747 bytes.
- Live Obsidian smoke: one React root; model/reasoning/external/MCP/send chrome rendered with no legacy toolbar owner; uncontrolled rich input remained editable; empty input disabled send and input events enabled it; no captured runtime errors.

## Phase 6.4 result — messages

- Added snapshot-driven React `MessageList`, ordered assistant content blocks, grouped tool runs, subagents, thinking, compaction boundaries, duration footers, and runtime-gated copy/fork/redo/navigation actions.
- Added generation-guarded owner-realm adapter slots for Obsidian Markdown, rich tool bodies, write/edit diff, ask-user fallback, and nested subagent rendering.
- The visible message list comes exclusively from `ChatUiSnapshot.messages`; the temporary hidden stream slot present at this slice was removed in Phase 6.5.
- React tests cover message action eligibility, block ordering, orphan tools, adapter cleanup, grouped tool status, pending/completed ask-user display, and snapshot-driven updates.

### Phase 6.4 verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | Boundaries remain green. |
| `npm run typecheck` | Passed | Source and tests. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 170 suites, 1,209 tests across 3 projects. |
| `npm run build` | Passed | Release artifacts deployed. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,366,850 bytes. |
| `obsidian plugin:reload id=pivi` | Passed | Reloaded after build. |

- `styles.css`: 115,747 bytes.
- Live smoke at slice completion: two injected stored messages rendered only in the React portal; user/assistant Markdown, thinking, duration, collapsed tool shell, and expanded rich tool result were visible.

## Phase 6.5 result — live streaming

- `ChatState.projectStreamChunk()` now keeps durable message identity, reduces each chunk before side effects, and republishes post-effect state.
- Preserved repeated partial tool input, ask-user answers, write/edit diffs, usage filters, subagent correlation/persistence, cancellation text, duration metadata, queue transitions, and stale-generation checks.
- Removed the hidden stream slot, live message/tool/thinking DOM maps, pending/grouped tool DOM state, RAF render queues, imperative thinking/text/tool presenters, and obsolete message-shell APIs.
- Subagent runtime managers now store pure records; only stored nested body adapters may create DOM inside React-owned slots.

## Phase 7 result — settings

- Added React settings store, shell, controls, and all eight pages: General, Models, Skills, Tools/Web search, Subagents, Commands, Integrations, and MCP.
- Added narrow settings ports for model/provider credentials and OAuth, custom endpoints/model catalogs, vault skills, external-read validation/picker, Bash allowlist, web credentials, command CRUD, MCP CRUD/test/auth/reload, and runtime refresh.
- React dialogs replace command and MCP modals with validation, busy/error, confirmation, and stale-effect cleanup.
- `mountSettings()` renders `SettingsRoot` directly; `PiviSettingTabHost` is now only an Obsidian lifecycle shell.
- Deleted `src/ui/settings/`, its imperative managers/modals/provider renderers/tests, the workspace settings-renderer bridge, and obsolete host contracts.

## Phase 8 result — inline edit

- Added a package React reducer/controller/view and deterministic mount API backed by `InlineEditPort` and `QueryBackedInlineEditService`.
- React owns instructions, clarification, spinner, diff, accept/reject, errors, and cancellation.
- The app adapter retains only CodeMirror effects/decorations, selection highlighting, owner-realm mount, offset mapping, editor replacement, the single-active guard, and promise resolution.
- Deleted the legacy inline-edit controller, input/diff widgets, and duplicate state/types.

## Phase 9 result — cleanup and final boundaries

- Renamed the remaining chat bridge to `ImperativeChatAdapter`; no legacy-surface/island naming or hidden legacy DOM remains.
- Deleted the temporary `UiPackageProbe`, obsolete assistant/thinking/message-shell renderers, old Todo DOM renderers, no-op stream wrappers, and their stale tests.
- Retained only explicit imperative adapters for uncontrolled contenteditable, Obsidian Markdown, rich tool/diff bodies, ask-user interaction, stored nested subagents, and CodeMirror decorations.
- Updated root/package/local `AGENTS.md` maps and package README ownership guidance.

### Final verification

| Command | Result | Notes |
|---|---|---|
| `npm run check:boundaries` | Passed | Architecture boundaries and package README coverage. |
| `npm run typecheck` | Passed | Source and test projects. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run test -- --runInBand` | Passed | 167 suites, 1,189 tests across 3 projects. |
| `npm run build` | Passed | `main.js`, `manifest.json`, and `styles.css` deployed. |
| `npm run analyze:bundle` | Passed | `main.js` is 3,269,601 bytes. |
| `obsidian plugin:reload id=pivi` | Passed | Final production build reloaded. |
| `obsidian dev:errors` | Passed | No errors captured after final smoke tests. |

- `styles.css`: 115,747 bytes.
- Live chat smoke: exactly one React root, visible in-flow new-chat control, React composer chrome, no legacy-named DOM; user/assistant Markdown, thinking, duration, and expanded rich tool result rendered from an injected immutable message snapshot.
- Live settings smoke: `PiviSettingTabHost` mounted one React settings root with all eight tabs and 19 React setting rows; no legacy-named DOM.
- Live inline-edit smoke: one owner-realm React widget mounted from the production command and Escape disposed it completely.

## Post-migration UI parity audit

- Restored the pre-React composer order: model → reasoning → external context → MCP → mode → action group/send.
- Replaced native `<select>` controls with the original compact hover/focus menus for model and reasoning, including reversed option order, provider groups, selected states, reasoning token titles, and the single-default-option hiding rule.
- Restored provider/model icons in both the collapsed model control and every model option. Bundled provider SVG masks, custom chat icons, and local Lucide fallbacks remain supported without runtime network assets.
- Restored the two-option mode label/toggle and the original send-button wrapper, alignment, state classes, and icon states.
- Added React regression coverage for toolbar order, provider icons, selector actions, mode toggling, reasoning changes, and send/stop states.

### UI parity verification

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | Source and test projects. |
| `npm run lint` | Passed | Zero warnings. |
| `npm run check:boundaries` | Passed | Architecture boundaries and package README coverage. |
| `npm run test -- --runInBand tests/obsidian-ui/ChatShell.test.tsx tests/unit/pi/ui/providerLogos.test.ts` | Passed | 2 suites, 19 tests. |
| `npm run build` | Passed | Production artifacts deployed to the configured vault. |
| `obsidian plugin:reload id=pivi` | Passed | Reloaded and reopened the chat view. |
| `obsidian dev:errors` | Passed | No errors captured. |

- Live DOM smoke confirmed the expected toolbar order, one visible icon on the selected model, icons on all five model options, six reasoning options, icon-bearing external/MCP controls, and the icon-bearing send button with the correct disabled state class.

### Final architecture

```text
src/app lifecycle/composition
  ├─ SettingsPorts ───────────────> @pivi/obsidian-ui SettingsRoot
  ├─ ChatPorts + ChatUiSnapshot ──> @pivi/obsidian-ui ChatShell/MessageList
  │                                  └─ empty slots -> explicit imperative adapters
  └─ InlineEditPort ──────────────> @pivi/obsidian-ui inline-edit React widget
                                     └─ app CodeMirror decoration/selection adapter
```

All planned migration phases are complete. The worktree remains intentionally uncommitted for review.

## UI parity follow-up (2026-07-12)

Restored remaining pre-React visual contracts that the migration summary had marked complete too early:

- Message turn actions again use Obsidian/Lucide icons (`copy`/`check`, `user`, `refresh-cw`, `git-fork`) with role-specific action classes and copy feedback.
- Composer External Context / MCP controls again use always-mounted hover/focus menus, the custom MCP brand SVG, and transparent button resets so Obsidian default button chrome no longer inflates size/background inconsistently with model/thinking.
- MCP dropdown chrome now matches model/thinking/external (`border-radius: 4px`, `box-shadow: 0 -2px 8px`, `z-index: 3000`) using Obsidian theme surfaces.
- React copy path again normalizes `app://obsidian.md/...` links via `getMessageCopyContent()`.
- Tool call headers again show per-tool icons and status icons (`check`/`x`/`shield-off`) instead of Unicode glyphs.
- Removed orphaned `dropdown-list.css` from the CSS manifest.
- Removed leftover dead CSS: `.pivi-tool-label`, `.pivi-mcp-selector-summary`, and `.pivi-mcp-selector-empty`.
- Accessibility focus-visible coverage includes external/MCP/mode toolbar controls.

Focused verification: MessageList, ChatShell, ToolCallView, and buildCss tests passed; source/typecheck and eslint on touched files are green.

## Settings UI parity follow-up (2026-07-12)

Restored pre-React settings visual contracts that Phase 7 had marked complete too early:

- Composer toolbar trigger buttons reset to `--background-primary` so Obsidian theme `button` chrome matches the input panel.
- Settings tab order restored: general → models → skills → tools → subagents → webSearch → commands → mcp → integrations.
- General tab regained nav mappings, hotkey grid (`.pivi-hotkey-*`), and shared environment editor (consumes `environment` + new `hotkeys` ports).
- Models tab restored `<details class="pivi-provider-card">` layout with logos, readiness badges, credentials/OAuth/custom panels, add-provider picker, and model checklist.
- Skills installed list restored to `.pivi-sp-item` cards with folder/badge/icon actions; Commands actions use `ObsidianIcon` instead of Unicode glyphs.
- Removed orphaned `plugin-settings.css` and unused `.pivi-settings-tab-content*`; added missing rules for template/external/no-models textareas.

## Decisions and blockers

- Inline-edit accept/reject keep Unicode `✓`/`✕` glyphs; that matched the pre-React widget.
- No known migration blocker remains.
