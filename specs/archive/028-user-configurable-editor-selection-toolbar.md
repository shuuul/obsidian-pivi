---
id: "028"
title: "User-configurable editor selection toolbar"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Amp"
---

# 028 — User-configurable editor selection toolbar

## Context

Pivi's editor selection toolbar is only partially configurable. `SelectionToolbar.tsx` always renders two Pivi-owned buttons before every configured shortcut:

1. **Ask AI**, which opens the existing inline-edit surface for the selected range.
2. **Add to chat**, which adds the selected range to the sidebar composer through `addEditorSelectionToChatInput`.

Settings > Toolbar cannot disable, remove, or reorder those buttons. It only edits the ordered `editorSelectionToolbar.shortcuts` array, whose current item kinds are `obsidian-command` and `pivi-command`. `SelectionToolbarSurfaceController.buildProps()` consequently passes the two fixed callbacks separately from configured shortcuts, so persisted order is not the complete rendered order.

The existing Obsidian-command picker already provides the underlying path needed for editor formatting buttons. It lists registered commands and stores their command IDs; the selection-toolbar controller executes those IDs against the active editor. Obsidian's built-in formatting commands include `editor:toggle-bold` and `editor:toggle-italics`, the same command-oriented approach used by the sibling `obsidian-note-toolbar` repository. Note Toolbar's gallery exposes common formatting actions such as bold, italic, strikethrough, highlight, code, headings, links, lists, indent, undo, and redo, while its toolbar editor keeps item order as the render order.

This work should adopt that item model without importing Note Toolbar's per-note rule system, scripting types, or private settings format. In Pivi, the two existing product actions become fixed-definition **Pivi actions** in the same ordered toolbar-item collection as editor commands and Pivi Commands. “Pivi action” in this spec means a Pivi-owned product action; it does not mean an undocumented Obsidian API.

Pivi actions are configurable only as toolbar membership state: users may enable/disable and reorder them, but cannot rename them, change their icon/behavior, duplicate them, or remove their settings rows. The `inline-edit` action keeps **Ask AI** as its floating-toolbar label and is described as Inline edit in Settings; `add-to-chat` keeps **Add to chat**. Likewise, the new **Add editor command** flow is a curated picker, not an arbitrary command editor. It adopts the command-type `editor:*` entries represented in Note Toolbar's gallery, with Pivi-owned canonical metadata and runtime availability checks against Obsidian's registered commands. Once added, an editor command may be enabled/disabled, reordered, or removed, but its command ID, label, tooltip, and icon remain canonical and cannot be edited.

## Goal and success criteria

Make the editor selection toolbar a single user-ordered list containing fixed Pivi actions, curated editor commands, and Pivi Commands, while preserving the current toolbar on migration.

- [x] Settings > Toolbar displays **Ask AI (Inline edit)** and **Add to chat** as fixed-definition Pivi action cards in the same sortable collection as all other toolbar items.
- [x] Users can enable/disable and reorder either Pivi action, but cannot remove it, duplicate it, rename it, change its icon, or edit its action binding.
- [x] The floating toolbar renders exactly the enabled persisted item order with no separately prepended fixed group.
- [x] **Inline edit** opens the existing inline-edit surface for the captured selection; **Add to chat** retains the existing sidebar-composer behavior. Neither action creates a parallel implementation or changes its current session/range semantics.
- [x] Settings > Toolbar replaces the generic **Add Obsidian command** entry point with **Add editor command**, backed by the curated catalog in this spec.
- [x] Users can add available editor commands such as Bold (`editor:toggle-bold`) and Italic (`editor:toggle-italics`), enable/disable and reorder them, and execute them against the selected editor range.
- [x] An added editor command has immutable canonical command ID, label, tooltip, and icon. Its compact card exposes a Remove action but no icon picker, command picker, label field, or other metadata editor.
- [x] Each curated editor command may appear at most once. The picker marks already-added commands unavailable rather than creating duplicates; disabling an item keeps it in Settings but hides it from the floating toolbar.
- [x] Catalog entries whose command ID is not registered in the current Obsidian environment are hidden or explicitly unavailable in the add picker and can never dispatch to another command as fallback.
- [x] A migration converts every legacy toolbar to the visual order users had before this change: Inline edit, Add to chat, then the legacy `shortcuts` order. Migration/repair is idempotent and produces exactly one record for each required Pivi action.
- [x] A fresh installation receives the same two-action default toolbar as the current product. Disabling either action remains durable; normalization may restore a malformed/missing required action record but must preserve its stored enabled state and user-defined position whenever valid.
- [x] Malformed, unknown, or duplicate Pivi action records are normalized deterministically; external persisted data cannot assign arbitrary callback identifiers, labels, or executable payloads to a Pivi action.
- [x] Legacy arbitrary `obsidian-command` shortcuts are retained without data loss. Commands matching the curated catalog normalize to editor-command metadata; unmatched legacy commands remain usable but cannot be newly added through **Add editor command**.
- [x] Settings cards, picker entries, floating-button tooltips, ARIA labels, empty states, and notices use canonical English keys mirrored in every locale.
- [x] Focused normalization/codec, Settings React, toolbar React, and controller tests cover migration, exact ordering, compact cards, enable/disable/remove, required-action repair, catalog filtering, and Bold/Italic dispatch.
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test -- --runInBand && npm run build && npm run check:bundle-size && npm run check:specs` pass before closeout.

## Scope and non-goals

In scope:

- One ordered persisted toolbar-item collection covering:
  - Fixed Pivi actions: Inline edit and Add to chat.
  - Curated Obsidian editor commands from the catalog below.
  - Existing Pivi Commands with their current Sidebar/Inline edit execution target.
- Normalization that preserves the old visual order, guarantees exactly one row for each required Pivi action, and retains valid enablement/order.
- Settings enable/reorder presentation for Pivi actions and added editor commands using the existing compact sortable-list conventions.
- A dedicated Add editor command picker with localized search, categories, canonical icon/label/description, duplicate filtering, and runtime availability state.
- Rendering and dispatch through one item list instead of fixed button props plus shortcut props.
- Full-locale i18n, focused automated tests, durable documentation, build/deploy, and live Obsidian verification.

Not in scope:

- Copying Note Toolbar's gallery JSON, search taxonomy, per-note/folder rules, separators, gaps, line breaks, menus, scripts, links, toolbar import/export, or mobile navigation toolbar.
- A general-purpose arbitrary Obsidian command picker. New additions are limited to the reviewed editor-command catalog; existing unmatched shortcuts are compatibility records only.
- Letting users create arbitrary Pivi-action IDs, remove required Pivi-action rows, edit callbacks, or override canonical action labels/icons with persisted data.
- Removing an added editor command or editing its command ID, label, tooltip, or icon. Added commands remain available as enableable/disableable rows.
- Changing Pivi Command Sidebar/Inline edit targets, workspace Command persistence, inline-edit diff review, archived sessions, or Add-to-chat context-chip semantics.
- Custom user scripts, arbitrary JavaScript callbacks, command macros, or multiple copies of the same Pivi action in one toolbar.
- Reading-mode, Canvas, Bases, PDF, or non-Markdown selection toolbars.
- Adopting additional undocumented Obsidian APIs. The existing host command-list adapter is retained as-is; any later replacement or expansion of that semi-private integration requires a separate review.

## Editor command catalog

The initial **Add editor command** catalog contains every command-type Note Toolbar gallery entry whose command ID begins with `editor:`. Pivi owns this reviewed static inventory and localized presentation metadata; it does not read Note Toolbar files or require Note Toolbar to be installed. At runtime, the picker cross-checks each ID against the current registered command list before allowing addition.

| Category | Canonical Obsidian command IDs |
|---|---|
| Formatting | `editor:clear-formatting`, `editor:toggle-blockquote`, `editor:toggle-bold`, `editor:toggle-code`, `editor:toggle-comments`, `editor:toggle-highlight`, `editor:toggle-inline-math`, `editor:toggle-italics`, `editor:toggle-strikethrough` |
| Headings | `editor:set-heading`, `editor:set-heading-0`, `editor:set-heading-1`, `editor:set-heading-2`, `editor:set-heading-3`, `editor:set-heading-4`, `editor:set-heading-5`, `editor:set-heading-6` |
| Lists and indentation | `editor:cycle-list-checklist`, `editor:indent-list`, `editor:toggle-bullet-list`, `editor:toggle-checklist-status`, `editor:toggle-numbered-list`, `editor:unindent-list` |
| Insert | `editor:attach-file`, `editor:insert-callout`, `editor:insert-codeblock`, `editor:insert-footnote`, `editor:insert-embed`, `editor:insert-horizontal-rule`, `editor:insert-link`, `editor:insert-mathblock`, `editor:insert-table`, `editor:insert-tag`, `editor:insert-wikilink` |
| Lines and cursors | `editor:add-cursor-above`, `editor:add-cursor-below`, `editor:delete-paragraph`, `editor:move-caret-up`, `editor:move-caret-down`, `editor:move-caret-left`, `editor:move-caret-right`, `editor:swap-line-down`, `editor:swap-line-up` |
| Folding | `editor:toggle-fold`, `editor:fold-all`, `editor:fold-less`, `editor:fold-more`, `editor:unfold-all` |
| Editor controls | `editor:open-search-replace`, `editor:toggle-source`, `editor:toggle-keyboard` |

The catalog intentionally excludes Note Toolbar's JavaScript-backed Undo/Redo items because they are not Obsidian command IDs, its own settings action, plugin-specific commands, and every non-command script/link/menu item. Catalog labels, descriptions, and icons are localized Pivi resources modeled after the reference inventory; persisted toolbar data stores command identity/order/enablement rather than user-editable copies of that metadata.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-22 | Replace the split “fixed actions + shortcuts” rendering contract with one ordered toolbar-item collection. | The persisted order must equal visible order for the toolbar to be genuinely user editable. Separate callback props force the two current actions to render first and outside the sortable list. | WS-01, WS-03, WS-04 |
| 2026-07-22 | Model the finite Pivi-owned items as `kind: 'pivi-action'` with an allowlisted action value of `inline-edit` or `add-to-chat`. Both rows are required, unique, enableable, and sortable but not removable or editable. | This distinguishes product actions from Pivi prompt Commands and Obsidian commands while preventing persisted settings from naming arbitrary callbacks. Permanent rows plus enablement give users visibility control without making core actions forgeable. | WS-01, WS-02, WS-03 |
| 2026-07-22 | Keep canonical Pivi-action label, tooltip, and icon metadata in code/i18n, not mutable persisted strings. Persist only identity, order, and enablement required for the action record. | Product-owned action metadata must stay localized and trustworthy. It also avoids stale translated labels in synced settings. | WS-01, WS-02, WS-04 |
| 2026-07-22 | Normalize legacy data to `[inline-edit, add-to-chat, ...legacy shortcuts]`; current normalization guarantees each Pivi action exactly once while preserving valid action position and enablement. | Required Pivi actions cannot be removed, so deterministic repair is correct. This keeps old visible order and allows durable disable/reorder choices without a deletion tombstone. | WS-01 |
| 2026-07-22 | Fresh defaults include Inline edit followed by Add to chat. Existing legacy shortcuts retain relative order after those two actions. | This exactly preserves current visible behavior and avoids a surprising toolbar change during upgrade. | WS-01, WS-05 |
| 2026-07-22 | Replace new arbitrary host-command additions with a dedicated `editor-command` catalog and **Add editor command** picker. Added entries are unique, removable, metadata-immutable, enableable, and sortable. | The requested surface is a safe editor toolbar, not a command editor. A curated catalog gives reliable names/icons while removal lets users return commands to the picker without making their identity or presentation editable. | WS-01, WS-02, WS-03 |
| 2026-07-22 | Build the initial catalog from every Note Toolbar gallery item whose type is `command` and whose ID begins `editor:`; copy the reviewed IDs/icons as Pivi-owned data rather than reading another plugin at runtime. Filter execution against the registered command list. | This captures Note Toolbar's relevant editor-command coverage while excluding its JavaScript-only Undo/Redo, Note Toolbar settings action, plugin commands, and private data format. | WS-02, WS-04 |
| 2026-07-22 | Continue using registered Obsidian commands for editor operations instead of implementing Markdown mutation in Pivi. | Obsidian commands preserve host editor behavior, plugin interoperability, undo semantics, and availability checks; this matches the proven Note Toolbar approach. | WS-02, WS-03 |
| 2026-07-22 | Preserve unmatched legacy `obsidian-command` items as compatibility records but do not expose them in the new picker. | Existing synced toolbars must not lose user configuration while the product narrows future additions to reviewed editor commands. | WS-01, WS-02 |
| 2026-07-22 | Do not depend on Note Toolbar at runtime. | Pivi's toolbar must work independently; Note Toolbar is a design/catalog reference, not a service or persistence dependency. | WS-02, WS-03 |
| 2026-07-22 | Preserve the existing top-level toolbar enable toggle and automatic yield while Note Toolbar's selected-text toolbar is active. | Item customizability is orthogonal to surface ownership and must not regress provider mutual exclusion. | WS-02, WS-03, WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define the unified toolbar-item contract; migrate legacy defaults/shortcuts; normalize required Pivi-action allowlist/uniqueness plus immutable editor-command identity; retain unmatched legacy command records; update synced settings codec/defaults. | Amp | Done | None | Foundation normalization + app settings codec/storage tests |
| WS-02 | Update Settings > Toolbar to show immutable Pivi action rows and compact removable editor-command rows in the sortable collection, add the curated **Add editor command** picker, and retain existing Pivi Command flows plus full i18n. | Amp | Done | WS-01 | `EditorToolbarSection` React tests + locale parity/dead-key checks |
| WS-03 | Refactor floating toolbar presentation/controller to render and dispatch one enabled ordered item list; route both Pivi actions to existing handlers and retain Obsidian/Pivi Command behavior. | Amp | Done | WS-01 | SelectionToolbar React + controller tests |
| WS-04 | Cover formatting-command behavior and edge cases: Bold/Italic dispatch, unavailable command feedback, exact order, empty toolbar, selection/focus retention, unknown action rejection, and no target fallback. | Amp | Done | WS-02, WS-03 | Focused Jest suites + live-vault scenarios |
| WS-05 | Synchronize durable docs/guidance, run full quality gates, build/deploy/reload, and complete manual acceptance in Live Preview and Source mode. | Amp | Done | WS-01–WS-04 | Documentation diff, full gates, Obsidian CLI evidence |

## Verification

Automated:

- Foundation normalization tests:
  - missing settings produce the fresh two-action default;
  - legacy `{ enabled, shortcuts }` data migrates to Inline edit, Add to chat, then legacy shortcut order;
  - missing/duplicate/unknown/malformed Pivi action records repair to exactly one canonical row per action without overwriting valid enablement/order;
  - matching legacy Obsidian commands normalize to immutable editor commands while unmatched commands survive as compatibility records;
  - editor-command metadata cannot be overridden by persisted labels/icons;
  - Pivi Command records retain their existing normalization and execution-target behavior.
- App codec/storage tests prove migration writes canonical item data and is stable on the next load.
- `tests/pivi-react/EditorToolbarSection.test.tsx` covers immutable Pivi-action rows, compact removable editor-command rows, catalog categories/search/availability, duplicate filtering, enablement, pointer/keyboard reorder, optimistic persistence rollback, and accessible names.
- `tests/pivi-react/SelectionToolbar.test.tsx` proves there are no implicit fixed buttons and that rendered button order exactly matches the supplied enabled item order.
- `tests/unit/app/ui/selectionToolbarSurfaceController.test.ts` covers `inline-edit`, `add-to-chat`, `editor:toggle-bold`, `editor:toggle-italics`, unavailable commands, stale selections, Pivi Command targets, and unknown item IDs without fallback.
- Locale tree/placeholder parity and `npm run check:i18n-dead-keys` cover every new or renamed UI key.
- Closeout gates: `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run test -- --runInBand`, `npm run build`, `npm run check:bundle-size`, and `npm run check:specs`.

Manual live-vault protocol:

1. Start from legacy toolbar settings containing at least one Obsidian command and one Pivi Command. Build, deploy, and reload Pivi; verify the visible order remains Inline edit, Add to chat, then the previous shortcuts.
2. Open Settings > Toolbar; verify both Pivi actions appear as immutable items with no Remove, icon, label, or binding editor. Move Add to chat after another command, disable Ask AI/Inline edit, reload Pivi, and verify exact order/visibility persists.
3. Open **Add editor command** and verify the curated categories, canonical icons/descriptions, unavailable-command state, and absence of arbitrary non-editor commands.
4. Add Bold (`editor:toggle-bold`) and Italic (`editor:toggle-italics`); verify they cannot be edited or added twice, then disable/re-enable, reorder, remove, and re-add them.
5. Select text in Live Preview and Source mode and verify Bold/Italic toggle formatting with the expected selection/caret and undo behavior.
6. Verify Inline edit still opens the existing embedded surface and Add to chat still creates the existing composer context chip; exercise one Pivi Command for each execution target.
7. Disable every item and verify selecting text does not produce an empty floating chrome surface. Re-enable one item and verify the surface returns.
8. Enable Note Toolbar's selected-text toolbar and verify Pivi still yields; disable it and verify Pivi resumes with the configured item list.
9. Run `obsidian dev:errors` and expect `No errors captured.`

## Documentation sync

- Numbered developer docs: update the page owning editor-selection toolbar and inline-edit flow (currently `docs/11-chat-ui-evolution.md` if no closer owner exists) with unified item ordering, Pivi actions, and migration behavior.
- Nearest local guidance: update `src/app/AGENTS.md` for unified dispatch and `src/ui/shared/AGENTS.md` only if overlay lifecycle behavior changes.
- Parent/package guidance: update `packages/pivi-agent-core/AGENTS.md` for the versioned toolbar-item normalization contract and `packages/pivi-react/AGENTS.md` for the unified Settings/render ordering invariant.
- Root guidance and roadmap: update root `AGENTS.md` only if its current toolbar summary becomes inaccurate; update `docs/10-roadmap-release-and-maintenance.md` only if this feature is tracked there.

## Progress and handoff

### 2026-07-22 — Amp — specification and repository analysis

- Changed: Created and refined a decision-complete Draft covering the unified item model, required immutable Pivi actions, curated immutable editor commands, legacy migration, workstreams, and acceptance matrix.
- Evidence: Verified that `SelectionToolbar.tsx` currently hard-codes Ask AI and Add to chat; `EditorToolbarShortcut` only permits Obsidian/Pivi Commands; settings persist only `shortcuts`; `SelectionToolbarSurfaceController` already owns both fixed handlers and command dispatch; the sibling Note Toolbar uses `editor:toggle-bold` and `editor:toggle-italics` command items in its formatting gallery.
- Remaining: Review the Draft decisions, then activate and implement WS-01–WS-05.
- Blockers: None.
- Next action: Confirm the curated editor-command inventory and immutable-card behavior, set status to Active, and claim WS-01.

### 2026-07-22 — Amp — implementation start

- Changed: User approved the refined specification; set it to Active and claimed WS-01–WS-05 for one coordinated implementation because the settings model, React cards, and runtime dispatch share the same discriminated union.
- Evidence: The approved catalog and immutable interaction constraints are recorded above.
- Remaining: Implement, verify, deploy, synchronize durable documentation, and close the spec.
- Blockers: None.
- Next action: Land the unified settings contract and migration before changing presentation consumers.

## Completion summary

Delivered one normalized, user-ordered selection-toolbar registry containing the two required immutable Pivi actions, removable curated editor commands with canonical metadata, legacy compatibility rows, and editable Pivi Commands. Settings now exposes all 51 reviewed `editor:*` entries, disables unavailable/already-added entries, prevents overlapping optimistic saves, and preserves exact enabled order at runtime. Dispatch retains Ask AI's host-snapshot recovery, Add to chat's active-editor behavior, exact Obsidian command IDs, and existing Pivi Command targets; no surface mounts when every row is disabled.

Verification passed: 2,251 Jest tests across 286 suites, source/test typecheck, ESLint, architecture/package/i18n/spec boundaries, production build, and bundle-size gate (3.16 MB with 1.84 MB headroom). The built artifact was auto-deployed, matched the deployed `main.js` checksum, reloaded successfully, and `obsidian dev:errors` reported no captured errors. Durable behavior is documented in `docs/11-chat-ui-evolution.md` and the nearest core, React, and app guidance files. No scope deviations were required.
