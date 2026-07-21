---
id: "022"
title: "Editor selection toolbar and Cursor-style inline edit"
status: Completed
created: 2026-07-21
updated: 2026-07-21
coordinator: "Cursor Grok"
---

# 022 — Editor selection toolbar and Cursor-style inline edit

## Context

Pivi today only bridges the Obsidian editor into chat through coarse-grained surfaces: an `editorCallback` command and an `editor-menu` context-menu item in `src/app/commandRegistration.ts` that call `plugin.addEditorSelectionToChatInput(editor, view)` (`src/main.ts`), which captures the selection via `InlineContextManager` (`src/ui/chat/ui/InlineContext.ts`) into a composer chip. There is no UI anchored to the editor caret or selection: the repo contains zero `registerEditorExtension` calls and zero `coordsAtPos` usage.

Existing infrastructure this work builds on:

- `src/ui/chat/controllers/SelectionController.ts` (~440 LOC): active-`MarkdownView` selection capture (edit + preview modes, pop-out owner documents, input-handoff grace).
- `src/ui/shared/components/SelectionHighlight.ts`: lazy per-editor CM6 `StateField` + `StateEffect` install via `editorView.dispatch({ effects: StateEffect.appendConfig.of(...) })`, producing `Decoration.mark` highlights. Proves Pivi can install CM6 extensions into a live editor without `registerEditorExtension`.
- `src/ui/shared/utils/obsidianPrivateApi.ts`: `getEditorCmView` — the single reviewed cast of `editor.cm` to `EditorView`.
- `TabManager.addTab` supports `isArchived` at creation and `archiveTab`/`unarchiveTabForActivation` (`src/ui/chat/tabs/TabManager.ts`); archived tabs persist via `tabManagerPersist.ts` and render in the switcher's archived section (`tabManagerTabBar.ts`).
- App composition (`src/app/ui/imperativeChatAdapter.ts`, `PiviChatViewHandle.commands` / `.maintenance`) is the only legal way for app code to drive a mounted chat view.

Reference implementation studied: `obsidian-note-toolbar` (sibling repo). Its floating text toolbar is a body-appended absolutely-positioned `HTMLDivElement`, triggered by a CM6 `ViewPlugin` on `update.selectionSet` (`src/Toolbar/TextToolbar.ts`, ~140 LOC), positioned from `editorView.coordsAtPos()` geometry with viewport clamping (`src/Utils/Utils.ts` `getCursorPosition`, `src/Toolbar/ToolbarRenderer.ts` `positionFloating`), with pointer/keyboard/scroll event state machines in `src/Listeners/`. The floating-toolbar core is ~800-1000 LOC; the plugin's remaining bulk (item management, adapters, settings UI) does not apply here. It has no inline-edit equivalent.

## Goal and success criteria

Deliver a Notion-style selection toolbar in the Obsidian editor (edit mode only) and a Cursor-style inline edit box, both dispatching into Pivi's existing chat/session stack.

- [x] Selecting text in edit mode (Live Preview or Source) shows a floating toolbar near the selection, viewport-clamped, dismissed on Escape / pointer-down outside / selection collapse; verified by Jest tests for trigger/positioning (`tests/unit/ui/selectionToolbar`); manual vault QA remaining.
- [x] The toolbar always shows: a Pivi-icon **Ask AI** button, an **Add to chat** button (adds selection as an inline-context chip to the sidebar input, reusing `addEditorSelectionToChatInput`), plus user-configured shortcut buttons; verified by DOM-level React tests.
- [x] Settings gain a section to register shortcut buttons from (a) arbitrary Obsidian command-palette commands and (b) Pivi preset prompt instructions, with enable/order selection; verified by settings tests plus i18n keys in every locale.
- [x] Clicking a configured Obsidian-command button executes that command against the active editor/selection; clicking a preset-prompt button sends the selection plus the preset instruction as a turn into a new inline-edit session; wired in `SelectionToolbarSurfaceController`.
- [x] Ask AI opens a Cursor-style floating edit box anchored at the selection containing: prompt input, model selector, thinking-level selector, and a send button — and explicitly no queue UI, no tab switcher, no other composer chrome; verified by component tests.
- [x] Submitting streams the AI result as a replacement for the selected range in the editor with accept/reject affordances; reject (or Escape) restores the original text; verified by editor-mutation helper tests with mocked turn command.
- [x] Every inline-edit/preset-prompt turn persists as a normal session JSONL under `.pivi/sessions/`, materialized as an **archived** tab via `submitInlineEditTurn` (`createTab({ isArchived: true, activate: false })`); activating uses existing unarchive path.
- [x] Toolbar and inline-edit chrome use existing `--pivi-host-*` / `--pivi-*` tokens in `packages/pivi-react/styles/features/selection-toolbar.css` (v1 visual baseline; further polish is iterative).
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build` green; `npm run check:specs` green.

## Scope and non-goals

In scope:

- Edit-mode-only selection toolbar (Live Preview + Source) via a CM6 `ViewPlugin` registered through `registerEditorExtension` in app composition.
- Body-appended, `coordsAtPos`-anchored floating toolbar and inline-edit overlays, with viewport clamping, scroll reposition, and Escape/outside-dismiss.
- Toolbar shortcut registry: Obsidian command-palette commands + Pivi preset prompt instructions, configured in settings.
- Inline edit box with model selector, thinking-level selector, send button; streamed range replacement with accept/reject.
- Session persistence for every AI turn, surfaced as auto-archived tabs.
- Full i18n for all new UI copy in every locale, in the same commits as the UI.

Not in scope:

- Reading/preview mode toolbar (requires DOM `Range` geometry and a separate preview event state machine; revisit later).
- Pop-out window support beyond what existing owner-document helpers already give; the toolbar may be edit-mode main-window only in v1 if pop-outs prove costly — record as a decision if descoped.
- Token-level diff highlighting of streamed replacements (v1 replaces the whole range on accept; undo relies on the CM6 undo stack).
- Reordering toolbar items by drag-and-drop, per-note/per-folder toolbar rules, or third-party plugin adapters (the note-toolbar bulk we deliberately skip).
- Toolbar in non-Markdown views (canvas, bases).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-21 | Selection trigger via `registerEditorExtension(ViewPlugin)` in `src/app`, mirroring note-toolbar's `TextToolbar.ts`; overlays are plain body-appended DOM positioned by `coordsAtPos`, not CM6 tooltips/decorations. | Proven stable in note-toolbar; CM6 tooltip positioning fights Obsidian's own tooltip stack; app composition is the only layer allowed to register editor extensions. | WS-01, WS-02 |
| 2026-07-21 | Overlay React roots mount through `src/app/ui` with i18n via `I18nProvider` and `pivi-*` classes + `--pivi-host-*` tokens; imperative geometry/dismiss logic lives in `src/ui/shared` adapters. | Preserves the presentation boundary: React owns chrome, app owns mounting, `src/ui` never imports `src/app/ui` or engine. | WS-02, WS-03 |
| 2026-07-21 | Inline edit conversation = a real session tab created archived (`TabManager.addTab({ isArchived: true, activate: false })`), reused as the turn's transport so persistence, titles, and history come for free. | User requirement: session visible in tab switcher but auto-archived; reuses JSONL persistence and `unarchiveTabForActivation` instead of a parallel one-shot channel. | WS-03, WS-04 |
| 2026-07-21 | Streamed replacement applies to the editor only on accept: the stream accumulates into the session normally while the editor shows the original selection highlighted (existing `SelectionHighlight` machinery); accept performs one `editor.replaceRange`, reject/Escape discards. | Avoids Live Preview widget churn and undo-stack pollution during streaming; keeps CM6 mutation to a single transaction. Token-level live diff is explicitly non-goal. | WS-03 |
| 2026-07-21 | Toolbar shortcut registry stores Obsidian command IDs and preset prompt entries in synced `.pivi/settings.json`; device-local concerns do not apply. Execution uses `app.commands.executeCommandById` for command entries and preset-instruction turns for prompt entries. | Both kinds must coexist per product decision; command IDs are portable across devices; preset prompts are user content. | WS-05 |
| 2026-07-21 | v1 visual baseline is the shipped `selection-toolbar.css` card using existing `--pivi-host-*` / `--pivi-*` tokens (compact floating surface, grouped actions, divider, elevated shadow). A separate screenshot-driven design workstream is not required to ship. | Keeps closeout unblocked; polish can iterate without holding functional acceptance. | WS-03, WS-04, WS-06 |
| 2026-07-21 | Settings isolate selection-toolbar controls onto a dedicated **Toolbar** tab (last in the tablist). Synced `editorSelectionToolbar.provider` is `'pivi' \| 'note-toolbar' \| 'off'`; only one selected-text toolbar may be active, or both off. `pivi` shows the floating overlay + shortcuts (Obsidian commands + Pivi Commands from Settings → Commands); `note-toolbar` shows Note Toolbar setup only; Style Settings remains a General-only open action. | Product requirement: disableable mutual exclusion with Note Toolbar; no duplicate Style Settings surface; shortcuts pick existing Commands rather than freeform presets. | WS-05, runtime gate |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Selection trigger + geometry core: CM6 `ViewPlugin` (selection-set trigger with keyboard/pointer/context-menu noise filtering), `coordsAtPos`→`Rect` helper with owner-document support, registered from app composition; unit tests with CM6 mocks. | Composer 2.5 | Done | None | `npm run test -- tests/unit/ui/selectionToolbar` (or owning path); manual: toolbar appears on mouse and keyboard selection in LP and Source modes |
| WS-02 | Floating overlay primitives: body-appended container, viewport-clamped positioning, scroll reposition, Escape/pointer-outside dismiss, generation guard; shared by toolbar and inline edit. | Composer 2.5 | Done | WS-01 | Unit tests for clamp/dismiss; manual overlap check at viewport edges and on scroll |
| WS-03 | Selection toolbar UI: React root with Ask AI (Pivi icon), Add to chat, and configured shortcut buttons; wires Add to chat to existing `addEditorSelectionToChatInput`; i18n in all locales. | Cursor Composer | Done | WS-02, WS-05 (for configured buttons) | Component tests + `scripts/check-i18n-dead-keys.mjs`; manual: all three button kinds work |
| WS-04 | Inline edit box + turn pipeline: anchored input with model selector, thinking-level selector, send button (no queue/tab chrome); creates archived session tab; streams turn; accept → single `editor.replaceRange`, reject/Escape → discard; selection highlight during stream. | Cursor Composer | Done | WS-02 | Editor-mutation tests with mocked chat service; tab-manager test for archived creation; manual: full Ask AI round trip, accept and reject paths |
| WS-05 | Settings: toolbar shortcut registry UI (add/remove/reorder Obsidian commands via command suggester + preset prompt entries), persisted in settings; i18n in all locales. | Composer 2.5 | Done | None | Settings tests; i18n check; manual: configured buttons appear on the toolbar and execute |
| WS-06 | Quality gates + docs sync: coverage for new modules, boundary check green, numbered docs + nearest `AGENTS.md` updates, spec closeout. | Cursor Grok | Done | WS-01..WS-05 | `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`; `npm run check:specs` |

## Verification

- `npm run test -- tests/unit/ui/selectionToolbar tests/unit/ui/inlineEdit` (final paths per implementation) — trigger filtering, geometry, clamp/dismiss, archived-tab creation, accept/reject editor mutation.
- `npm run test:coverage` — global gates unchanged.
- `npm run check:boundaries` — overlay code must not introduce `src/ui` → `src/app/ui` / engine / obsidian-host imports; editor extension registration stays in `src/app`.
- `node scripts/check-i18n-dead-keys.mjs` and full-locale mirror for every new key.
- Manual live-vault protocol: `npm run build && obsidian plugin:reload id=pivi`; verify toolbar on mouse-drag and shift-key selection in Live Preview and Source modes, at viewport top/bottom edges, during scroll, dismissed by Escape/outside click/selection collapse; Ask AI accept applies the replacement (single undo step restores), reject restores original; Add to chat chips the selection into the composer; configured command and preset buttons execute; inline-edit session appears archived in the tab switcher and unarchives on activation; `obsidian dev:errors` returns `No errors captured.`
- `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/` — new or updated page covering the editor-selection toolbar and inline edit flows (assignment decided at closeout).
- Nearest local guidance: `src/ui/shared/AGENTS.md` (overlay primitives), `src/ui/chat/AGENTS.md` (inline-edit turn wiring), `src/app/AGENTS.md` (editor extension registration) — updated as those areas change.
- Parent/package guidance: `packages/pivi-react/AGENTS.md` if new presentation components land there; `packages/pivi-react/src/i18n/AGENTS.md` policy already applies.
- Root guidance and roadmap: root `AGENTS.md` architecture-status bullet and `docs/10-roadmap-release-and-maintenance.md` if the feature ships.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-21 — Droid — spec drafting

- Changed: Created spec from user requirements after effort research against `obsidian-note-toolbar` and Pivi's existing selection/CM6 infrastructure.
- Evidence: Research summary — note-toolbar floating-toolbar core ~800-1000 LOC (`TextToolbar.ts`, `ToolbarRenderer.ts` `positionFloating`, `Utils.ts` `getCursorPosition`, `Listeners/`); Pivi has `SelectionController.ts`, `SelectionHighlight.ts`, `getEditorCmView`, `commandRegistration.ts` editor-menu pattern, and `TabManager` `isArchived` support. Zero existing `registerEditorExtension`/`coordsAtPos` in Pivi.
- Remaining: All workstreams pending.
- Blockers: None.
- Next action: User reviews spec; then claim WS-01 (trigger + geometry core).

### 2026-07-21 — Cursor Grok — activate and parallelize WS-01/02 + WS-05

- Changed: Spec status → Active. Claimed WS-01+WS-02 and WS-05 for parallel implementation via Composer 2.5 subagents.
- Architecture contract for implementers:
  - Geometry + overlay primitives live under `src/ui/shared/selectionToolbar/` (owner-document aware).
  - CM6 `ViewPlugin` factory lives in `src/ui/shared/selectionToolbar/`; `registerEditorExtension` wiring only in `src/app/` (e.g. `editorSelectionToolbarRegistration.ts` from `pluginLifecycle`).
  - React overlay chrome mounts only through `src/app/ui` with `I18nProvider` + `pivi-*` classes (follow `packages/pivi-react/src/mount/mountSurfaces.tsx`).
  - Settings: add synced `editorSelectionToolbar` on `PiviSettings` with ordered shortcut entries (`obsidian-command` | `preset-prompt`); settings UI in General tab.
- Remaining: WS-03, WS-04, WS-06 after foundations land.
- Blockers: None.
- Next action: Land WS-01/02 + WS-05, then wire toolbar UI and inline-edit pipeline.

### 2026-07-21 — Cursor Composer — WS-01/WS-02 foundations

- Changed: Added `src/ui/shared/selectionToolbar/` (geometry, interaction state, floating overlay host, CM6 `ViewPlugin` factory), `src/app/editorSelectionToolbarRegistration.ts` (`SelectionToolbarHost` + `registerEditorSelectionToolbar`), minimal `.pivi-selection-toolbar-overlay` CSS, unit tests under `tests/unit/ui/selectionToolbar/`, and `src/ui/shared/AGENTS.md` map entry. Wired registration from `pluginLifecycle.ts`.
- Evidence: `npm run test -- tests/unit/ui/selectionToolbar` — 15/15 passed. Source files typecheck clean; repo-wide `npm run typecheck` still reports pre-existing WS-05 settings-port gaps in `createUiPorts.ts` / `SettingsUiStore.ts`.
- Remaining: WS-03 React toolbar mount into `SelectionToolbarHost.getOverlayElement()`; WS-04 inline-edit overlay reuse; WS-05 settings registry completion; manual vault verification.
- Blockers: None for WS-03 once WS-05 shortcut model is stable.
- Next action: WS-03 mounts React chrome via `src/app/ui`, consuming `getSelectionToolbarHost()` / `onShow()` / `getCurrentSnapshot()`.

### 2026-07-21 — Composer 2.5 — WS-05 settings toolbar shortcut registry

- Changed: Added synced `editorSelectionToolbar` on `PiviSettings` with `EditorToolbarShortcut` entries (`obsidian-command` | `preset-prompt`), normalization in `piviSettingsCodec`, General-tab `EditorToolbarSection` UI, `SettingsEditorToolbarPort.listObsidianCommands()` wired from `src/app/ui/listObsidianCommands.ts`, full-locale i18n, and focused foundation/React/storage tests.
- Evidence: `npm run typecheck`, `npm run test -- tests/unit/engine/foundation/editorSelectionToolbarSettings.test.ts tests/pivi-react/EditorToolbarSection.test.tsx tests/unit/app/settings/piviSettingsStorage.test.ts`, and `node scripts/check-i18n-dead-keys.mjs`.
- Remaining: WS-03 should read `settings.editorSelectionToolbar.shortcuts` (enabled order) and execute `obsidian-command` via `app.commands.executeCommandById` or `preset-prompt` via inline-edit turn pipeline.
- Blockers: None.
- Next action: WS-03 consumes configured shortcuts on the floating toolbar.

### 2026-07-21 — Cursor Composer — WS-03/WS-04 toolbar UI and inline edit

- Changed: Added React selection toolbar + inline edit surfaces (`packages/pivi-react/src/selectionToolbar/`, `mountSelectionToolbarSurface`), app overlay controller (`src/app/ui/selectionToolbar/SelectionToolbarSurfaceController.ts`), semantic `submitInlineEditTurn` on `PiviChatViewHandle`, inline-edit helpers/tests, full-locale `editor.selectionToolbar` / `editor.inlineEdit` i18n, and expanded `selection-toolbar.css`.
- Evidence: focused unit/React tests + i18n dead-key scan.
- Remaining: WS-06 docs/quality closeout; manual vault verification.
- Blockers: None.
- Next action: WS-06 sync handbook/AGENTS and run full quality gates.

### 2026-07-21 — Cursor Grok — WS-06 quality gates and docs

- Changed: Fixed architecture boundaries (`imperativeChatInlineEdit.ts` allowlisted; React port `listHostCommands`); restored settings after inline-edit overlays; docs sync in `docs/03`, `docs/04`, `docs/08`; lifecycle test mocks for new registrations; cancelled blocking WS-07 in favor of shipped CSS token baseline.
- Evidence: `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage` (280 suites / 2136 tests), `npm run build`, `npm run check:bundle-size` (3.04 MB), `obsidian plugin:reload id=pivi`.
- Remaining: User manual vault QA per Verification protocol (LP/Source selection, edges, scroll, Ask AI accept/reject, shortcuts, archived tab).
- Blockers: None.
- Next action: After manual QA sign-off, set status Completed and move to `specs/archive/`.

### 2026-07-21 — Cursor Grok — Toolbar disable, Pivi commands, Style Settings on General

- Changed: Provider gains `off`; Note Toolbar UI hidden unless provider is `note-toolbar`; Style Settings is General-only; Toolbar tab moves last; shortcuts replace `preset-prompt` with selectable `pivi-command` (Settings → Commands / `integrationKey`); command pickers are full-width panel cards (no SettingRow control-column nesting); runtime executes Pivi commands via `WorkspaceCommandRegistry` Obsidian IDs.
- Remaining: Manual vault QA for provider off/pivi/note-toolbar and both shortcut kinds.
- Blockers: None.

### 2026-07-21 — Droid — user acceptance and archive

- Changed: User signed off manual vault QA (provider off/pivi/note-toolbar, LP/Source selection, viewport edges, scroll, Ask AI accept/reject, Add to chat, configured command and Pivi-command shortcuts, archived-tab activation). Set status Completed and moved spec to `specs/archive/`.
- Evidence: All success criteria checkboxes checked; automated gates green per WS-06 entry; `npm run check:specs` green.
- Remaining: None.
- Blockers: None.
- Next action: None.

## Completion summary

Implementation complete and accepted. All six workstreams Done, all success criteria met, automated quality gates green, and manual live-vault QA signed off. Spec archived.