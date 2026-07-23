---
id: "029"
title: "Toolbar command controls and pickers"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Amp"
---

# 029 — Toolbar command controls and pickers

## Context

Spec 028 introduced one persisted ordered collection for Pivi actions, curated editor commands, legacy arbitrary Obsidian commands, and Pivi Commands. The first Settings presentation has three follow-up interaction problems: the global toolbar toggle and row toggles are not explicitly isolated by behavior tests, arbitrary Obsidian commands no longer have an add flow, and an existing Obsidian command's icon picker is hidden inside its disclosure body. Picker rows also use inconsistent icon and information layouts.

The persisted array remains the source of toolbar order. “Separately stored” in this follow-up means separate item kinds and separate Settings add catalogs, not separate arrays that would make cross-kind toolbar ordering impossible.

## Goal and success criteria

Make every toolbar item independently enableable, restore a separate arbitrary Obsidian-command add flow, and expose command identity and icon controls without opening a card.

- [x] Every Pivi action, editor command, Obsidian command, and Pivi Command row has an independent enable toggle.
- [x] The global toolbar toggle and row toggles have distinct accessible names and click targets; changing one never changes another or opens/closes a disclosure.
- [x] Settings exposes separate **Add editor command** and **Add Obsidian command** flows while preserving one persisted cross-kind order.
- [x] The editor picker contains only the fixed curated `editor:*` catalog; the Obsidian picker contains arbitrary registered commands outside that catalog and prevents duplicates.
- [x] Editor, Obsidian, and Pivi command picker rows display an icon and a consistent name/supporting-text hierarchy.
- [x] An Obsidian command's icon selector is visible in the card header and can be used without opening its disclosure; icon interaction does not initiate drag, toggle enablement, remove the item, or toggle disclosure state.
- [x] Pending persistence disables every mutating control and the synchronous save lock prevents overlapping optimistic writes.
- [x] Focused React tests, typecheck, lint, boundaries, full tests, build, bundle-size, specs, deployment, and live Obsidian error checks pass.

## Scope and non-goals

In scope:

- Settings presentation, item enablement interactions, separate command pickers, top-level Obsidian icon selection, CSS polish, i18n, tests, and durable guidance.
- Compatibility with the normalized unified toolbar array from Spec 028.

Not in scope:

- Splitting persisted order into separate arrays, changing runtime dispatch, adding duplicate curated commands through the arbitrary picker, or making curated editor-command metadata editable.
- Changing Pivi action behavior, Pivi Command execution targets, Note Toolbar mutual exclusion, or the floating toolbar visual design.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-22 | Keep one persisted ordered item array while giving editor and arbitrary Obsidian commands separate add catalogs and item kinds. | One array is required for exact cross-kind drag order; separate pickers solve discovery and ownership without losing ordering semantics. | WS-01, WS-02 |
| 2026-07-22 | Exclude every curated `EDITOR_COMMANDS` ID from the arbitrary Obsidian picker. | Curated commands have immutable canonical metadata and uniqueness rules; admitting the same IDs through a mutable legacy path would create ambiguous duplicates. | WS-01 |
| 2026-07-22 | Put the Obsidian icon trigger directly in the header's icon slot and treat it as an isolated control. | Icon choice is the primary visual identity of an arbitrary command and should not require disclosure navigation; isolated event handling prevents conflicts with sorting and expansion. | WS-01, WS-02 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Implement separate editor/Obsidian pickers, icon-bearing picker rows, top-level Obsidian icon selection, and isolated toggles. | Amp | Done | None | `EditorToolbarSection` React tests |
| WS-02 | Polish responsive card/picker layout using package design conventions and synchronize i18n/docs. | Amp | Done | WS-01 | Focused visual DOM/CSS assertions, locale checks |
| WS-03 | Run complete automated gates, deploy, reload, and inspect live Obsidian behavior/errors. | Amp | Done | WS-01–WS-02 | Repository gates and Obsidian CLI evidence |

## Verification

- Focused Jest: `npm run test -- --runInBand tests/pivi-react/EditorToolbarSection.test.tsx tests/pivi-react/SelectionToolbar.test.tsx tests/unit/engine/foundation/editorSelectionToolbarSettings.test.ts tests/unit/app/ui/selectionToolbarSurfaceController.test.ts tests/unit/app/pluginLifecycle.test.ts`.
- Gates: `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run test -- --runInBand`, `npm run build`, `npm run check:bundle-size`, and `npm run check:specs`.
- Live Obsidian: inspect Settings > Toolbar at desktop and narrow widths; toggle every item kind; use a header icon picker; add one item from each command catalog; reload; verify persisted order/state and `obsidian dev:errors`.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` only if its persisted/settings flow needs clarification.
- Nearest local guidance: `packages/pivi-react/AGENTS.md` and `packages/pivi-react/styles/AGENTS.md` if implementation changes their durable UI contract.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` only if normalization changes (not expected).
- Root guidance and roadmap: None expected; this is a bounded Settings follow-up.

## Progress and handoff

### 2026-07-22 — Amp — WS-01/WS-02

- Changed: Activated the follow-up spec after inspecting the current unified item model, settings cards, picker rows, toggle implementation, and CSS grid.
- Evidence: Every item already persists an `enabled` field, but only the global/required-action toggle interaction has partial coverage; arbitrary host-command additions were removed in Spec 028; `CommandIconPicker` currently mounts only in the Obsidian disclosure body.
- Remaining: Implement and verify the interaction/UI changes, synchronize durable guidance, then run deployment acceptance.
- Blockers: None.
- Next action: Restore an exclusive arbitrary Obsidian picker and move icon selection into the card header with event isolation.

### 2026-07-22 — Amp — WS-01/WS-02/WS-03

- Changed: Added isolated per-item toggles, separate curated Editor and arbitrary Obsidian add pickers, icon-bearing rows for all three command catalogs, a header-level Obsidian icon selector, pending-save control locks, and responsive card/picker polish.
- Evidence: Focused toolbar suite passed 10/10; related focused suites passed 35/35; repository suites passed 286/286 and 2253/2253 tests. Typecheck, lint, architecture/package boundaries, i18n dead-key scan, spec checks, production build, and bundle-size check passed. Production assets were copied to the configured Obsidian plugin directory; `obsidian plugin:reload id=pivi` succeeded and `obsidian dev:errors` reported no errors.
- Remaining: None.
- Blockers: None. Jest still emits pre-existing asynchronous `act(...)` diagnostics; bundle-size reporting still emits the known >10% baseline-growth warning while remaining 1.84 MB below the 5 MB cap.
- Next action: Archive this completed spec.

## Completion summary

Toolbar Settings now treats fixed Editor commands and arbitrary Obsidian commands as separate discovery catalogs while preserving one mixed ordered toolbar registry. Every item kind has an independent, accessible enable toggle; command lists expose recognizable icons and supporting text; arbitrary Obsidian commands expose icon selection directly in the card header; and all save-sensitive controls lock during persistence. Automated repository gates and deployed Obsidian reload/error checks passed.
