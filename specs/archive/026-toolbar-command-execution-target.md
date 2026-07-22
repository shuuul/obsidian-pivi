---
id: "026"
title: "Toolbar command execution target"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Amp"
---

# 026 — Toolbar command execution target

## Context

Settings > Toolbar currently stores an ordered `editorSelectionToolbar.shortcuts` list. A Pivi Command shortcut contains its stable slash-catalog `integrationKey`, but no execution behavior. `SelectionToolbarSurfaceController.handleShortcut()` therefore invokes the command's registered Obsidian command ID, and `WorkspaceCommandRegistry` always resolves the prompt and sends it to a new session in the configured Pivi chat view. The toolbar cannot use the same Command as an inline edit of the selected editor range.

The existing inline-edit path already owns the required editor behavior: `SelectionToolbarSurfaceController` captures a stable selection snapshot, `InlineEditSurfaceSession` owns the embedded composer and stream, and `submitInlineEditTurn` persists an archived session before presenting reply or diff-review accept/reject actions. The missing seam is a per-toolbar-shortcut execution target and an app-owned dispatcher that can route a Pivi Command to that existing path without pretending that an inline edit is an Obsidian command-palette invocation.

The current Toolbar shortcut card also renders `piviCommandKey` as visible metadata. This is the Command's opaque `integrationKey`, which intentionally survives Command renames so host registrations and toolbar references remain stable. It is implementation identity rather than meaningful user information; exposing values such as generated UUID-like keys makes the card look corrupt and must stop. The key remains persisted and used internally, while the card presents the Command label, optional description, and execution target.

Three storage locations were considered:

| Option | Consequence | Decision |
|---|---|---|
| Store the target in `.pivi/commands/*.md` | Changes the Command globally for slash use, command palette, Pivi toolbar, and Note Toolbar; a command with an inline target becomes ill-defined when invoked without an editor selection. | Reject. |
| Store one global default under `editorSelectionToolbar` | Simple, but prevents mixed toolbars such as “Summarize inline” beside “Research in sidebar.” | Reject. |
| Store the target on each `pivi-command` toolbar shortcut | Keeps the choice local to Settings > Toolbar, supports mixed behavior, and preserves every non-toolbar invocation. | Adopt. |

## Goal and success criteria

Let users choose whether each Pivi Command added in Settings > Toolbar runs against the selected range as an inline edit or sends its resolved prompt to a new sidebar session.

- [x] Every `pivi-command` toolbar shortcut has a persisted execution target of `inline-edit` or `sidebar`; Obsidian-command shortcuts remain unchanged.
- [x] Settings > Toolbar makes the target choice explicit when adding a Pivi Command and editable afterward on its shortcut card.
- [x] Pivi Command shortcut cards never render the opaque `piviCommandKey` / `integrationKey`; they show user-facing Command information and the selected execution target instead.
- [x] Existing persisted Pivi Command shortcuts with no target normalize to `sidebar`, preserving current behavior without a one-time destructive migration.
- [x] A `sidebar` shortcut retains current behavior: resolve Command variables, open Pivi at `chatViewPlacement`, create a new session, and send the turn.
- [x] An `inline-edit` shortcut resolves the Command instruction for the captured selection, automatically starts the existing inline-edit turn, streams in the embedded surface, and presents the existing reply or diff accept/reject UI.
- [x] Inline execution persists through the existing archived-session path and does not create a second sidebar-visible active tab.
- [x] The selected text appears exactly once in the inline-edit API prompt even when the Command contains `{{selected_text}}`; the canonical inline `<selected_text>` block remains the replacement source.
- [x] Missing/deleted Command entries, stale integration keys, collapsed selections, unavailable chat/runtime services, and empty resolved prompts fail with localized feedback and do not silently fall back to the other target.
- [x] Focused codec, Settings React, dispatcher, toolbar-controller, and inline-edit tests cover both targets and backward compatibility.
- [x] Each configured toolbar shortcut is a compact, clickable disclosure panel matching the Models > Provider interaction: the collapsed summary carries identity/status/actions, while icon/target/metadata configuration lives in the expanded body.
- [x] Disclosure state is local presentation state, does not alter persisted shortcut data, and sorting a card does not accidentally toggle it.
- [x] Newly added shortcuts open their panel for immediate review; enable/disable and remove remain available without expanding.

## Scope and non-goals

In scope:

- A host-neutral execution-target type and normalization on `EditorToolbarShortcut` for `pivi-command` entries.
- Settings > Toolbar add/edit presentation and full-locale UI copy for the two target choices.
- Removal of the visible Pivi Command integration key from shortcut cards while preserving the key as the durable lookup identity.
- App-owned Command lookup, variable resolution, and target dispatch from the selection-toolbar controller.
- Reuse of `WorkspaceCommandRegistry` sidebar semantics and the existing inline-edit session/turn/diff-review pipeline through a shared narrow invocation helper rather than duplicated prompt-context code.
- Deterministic handling of `{{selected_text}}`, `{{current_note}}` / `{{current_file}}`, note-name aliases, and `{{date}}` in both targets.
- Persistence, migration-by-normalization, tests, documentation, build, deploy, and live Obsidian verification.

Not in scope:

- Changing the default target or behavior of slash-menu, composer, command-palette, hotkey, or Note Toolbar invocations.
- Giving arbitrary Obsidian commands an inline-edit target; Pivi cannot infer their prompt or replacement protocol.
- Defining execution target in Command Markdown frontmatter.
- Allowing one Pivi Command to appear twice in the toolbar with different targets in this iteration; its existing shortcut card can switch targets. Revisit duplicate `(command, target)` entries only after a concrete workflow requires both.
- Adding a third target such as main tab, background run, or replace-without-review.
- A second inline-edit implementation, modal, or session format.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-22 | Add `executionTarget: 'inline-edit' \| 'sidebar'` only to `pivi-command` variants of `EditorToolbarShortcut`; normalize a missing/invalid value to `sidebar`. | The target describes a toolbar placement, not the reusable Command. Defaulting old values to the current route makes migration additive and behavior-preserving. | WS-01, WS-02 |
| 2026-07-22 | Keep one shortcut per Pivi Command and make its target editable. | This matches the requested either/or choice and the current integration-key deduplication model without introducing duplicate buttons or identity rules. | WS-01, WS-02 |
| 2026-07-22 | Inline target is a one-click execution, not merely a prefilled composer. | Sidebar target already executes immediately; target selection should alter where the result is applied, not add an extra submit step. The existing inline surface still provides stop and diff accept/reject control. | WS-03 |
| 2026-07-22 | Route inline targets directly through an app-owned Pivi Command dispatcher; do not call `app.commands.executeCommandById`. | The registered Obsidian command intentionally means “new sidebar session.” Direct dispatch preserves target semantics and avoids ambient command-registry coupling. | WS-03 |
| 2026-07-22 | Resolve inline Command templates as instructions and carry the selected range once in the canonical inline `<selected_text>` block. A shared resolver must consume `{{selected_text}}` without embedding another raw copy in the instruction. | Inline-edit protocol needs one authoritative replacement range; duplicating potentially large selected text wastes context and can confuse replacement generation. | WS-03, WS-04 |
| 2026-07-22 | A failure in the chosen target never falls back to the other target. | Silent fallback could unexpectedly create a chat session or edit note text, violating user intent. | WS-03, WS-04 |
| 2026-07-22 | Keep `integrationKey` opaque and persisted, but never render it on a Pivi Command shortcut card. Show the optional Command description and localized execution-target label as secondary information. | Stable identity is necessary for rename-safe lookup and Note Toolbar registration, but it has no user-facing semantics. | WS-02 |
| 2026-07-22 | Present each shortcut as a controlled `<details>` disclosure using the existing Models provider-card interaction rather than another always-expanded card layout. | Toolbar lists become scannable while configuration remains available on demand; reusing the established pattern preserves sorting and accessibility conventions. | WS-06 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Model `pivi-command` toolbar shortcuts as a target-bearing variant; normalize legacy/invalid data to `sidebar` while leaving Obsidian shortcuts untouched. | Amp | Done | None | Focused foundation/settings normalization and settings-codec tests |
| WS-02 | Add localized Settings > Toolbar target selection during Pivi Command addition and an editable control on existing Pivi Command cards; replace visible opaque integration keys with Command description/target metadata; preserve sorting, enablement, and pending/error behavior. | Amp | Done | WS-01 | `tests/pivi-react/EditorToolbarSection.test.tsx` (or owning suite), i18n checks |
| WS-03 | Extract a narrow app-owned workspace-Command invocation resolver/dispatcher, retain registry sidebar behavior, and route inline targets through automatic existing inline-edit submission with one canonical selection payload. | Amp | Done | WS-01 | Workspace registry/dispatcher and selection-toolbar controller tests |
| WS-04 | Cover stale commands, required selection, selection collapse/races, variable resolution, empty prompts, cancellation, service failure, archived persistence, and no target fallback. | Amp | Done | WS-03 | Focused app and inline-edit Jest suites |
| WS-05 | Synchronize durable docs/guidance, run full gates, build/deploy, reload Pivi, and complete the live-vault target matrix. | Amp | Done | WS-01–WS-04 | Documentation diff, quality gates, build/deploy, and Obsidian CLI reload evidence |
| WS-06 | Refactor shortcut cards into compact sortable disclosures, move per-shortcut configuration into the body, add interaction regressions, and redeploy. | Amp | Done | WS-02 | Focused Settings React tests, quality gates, and live-vault inspection |

## Verification

Automated:

- `npm run test -- --runInBand tests/unit/foundation/settings.test.ts` (or the owning normalization suite) — legacy default, valid targets, malformed target handling, and Obsidian shortcut shape.
- `npm run test -- --runInBand tests/pivi-react/EditorToolbarSection.test.tsx` — add flow, target edit, absence of visible integration keys, user-facing card metadata, optimistic persistence rollback, sorting, and accessibility labels.
- `npm run test -- --runInBand tests/unit/app/workspaceCommandRegistry.test.ts` plus the owning selection-toolbar controller suite — unchanged sidebar dispatch, direct inline dispatch, variable semantics, missing Command feedback, and no fallback.
- Existing inline-edit helper/imperative suites — one selected-text payload, automatic stream, cancel, archived session, reply, replacement, insertion, accept, and reject.
- `npm run typecheck`
- `npm run lint`
- `npm run check:boundaries`
- `npm run test -- --runInBand`
- `npm run build`
- `npm run check:bundle-size`
- `npm run check:specs`

Manual live-vault protocol:

1. Run `npm run build && obsidian plugin:reload id=pivi`.
2. In Settings > Commands, create one Command containing `{{selected_text}}`, `{{current_note_name}}`, and a visible instruction.
3. In Settings > Toolbar, add it with **Sidebar**, select editor text, click it, and verify one new sidebar session receives the resolved prompt while the note is unchanged.
4. Change the same shortcut to **Inline edit**, select text, click it, and verify the embedded surface starts immediately, streams, and offers the existing reply or diff review without activating a sidebar tab.
5. Reject one result and accept another; verify rejection preserves the range, acceptance performs the expected mutation, and the inline run remains available as an archived session.
6. Reload the plugin and verify the chosen target persists. Remove the backing Command and verify the stale shortcut reports a localized unavailable state without invoking sidebar behavior.
7. Run `obsidian dev:errors` and expect `No errors captured.`

## Documentation sync

- Numbered developer docs: update the page that owns editor-selection toolbar and inline-edit behavior (currently `docs/11-chat-ui-evolution.md` if no closer page exists) with the per-shortcut target and dispatch flow.
- Nearest local guidance: update `src/app/AGENTS.md` for Command target dispatch and `packages/pivi-react/AGENTS.md` for Toolbar target presentation/persistence.
- Parent/package guidance: update `packages/pivi-agent-core/AGENTS.md` if the target-bearing shortcut contract changes its package map or normalization invariants.
- Root guidance and roadmap: update `AGENTS.md` only if its architecture-status summary becomes incomplete; otherwise no root churn. Update `docs/10-roadmap-release-and-maintenance.md` only if this work changes a tracked roadmap item.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-22 — Amp — specification and repository analysis

- Changed: Defined the per-shortcut execution-target model, backward-compatible sidebar default, direct inline dispatcher, one-click behavior, selected-text deduplication invariant, workstreams, and acceptance matrix.
- Evidence: Verified current behavior in `EditorToolbarSection`, `EditorToolbarShortcut`, `SelectionToolbarSurfaceController`, `WorkspaceCommandRegistry`, `PiSlashCommandCatalog`, `resolveWorkspaceCommandPrompt`, and `buildInlineEditTurnContent`.
- Remaining: Implement WS-01–WS-05 after product approval of the Draft decisions.
- Blockers: None. The main product decision is recorded as one-click inline execution; change this before activation if inline should only prefill and wait for explicit submit.
- Next action: Approve the decisions, set the spec to `Active`, and claim WS-01 before implementation.

### 2026-07-22 — Amp — implementation and automated verification

- Changed: Added per-shortcut Sidebar/Inline edit persistence and Settings controls, hid opaque Command keys, dispatched inline targets by stable integration key through automatic inline-edit submission, and retained Sidebar command registration behavior.
- Evidence: Focused settings, storage, React, controller, and inline-edit tests pass; `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run build`, and `npm run check:bundle-size` pass. The full 2,231-test run had one expected-value failure caused by the new legacy `sidebar` normalization; that assertion was updated and its focused suite passes.
- Remaining: Final combined build/deploy/reload and live-vault inspection after spec 027, then close WS-05 and archive.
- Blockers: None.
- Next action: Execute spec 027, then run the shared deployment and manual acceptance entry point.

### 2026-07-22 — Amp — completion

- Changed: Completed the shared quality gates, built and deployed the plugin bundle, synchronized durable documentation, and closed all workstreams.
- Evidence: `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run build`, `npm run check:bundle-size`, and `npm run test -- --runInBand` pass; the final full run reports 286 suites and 2,233 tests passing.
- Remaining: User visual acceptance of the deployed Settings and inline-edit behavior.
- Blockers: None.
- Next action: Inspect Settings > Toolbar in the reloaded vault and exercise both execution targets.

### 2026-07-22 — Amp — disclosure-panel follow-up

- Changed: Reopened the spec after visual review found always-expanded shortcut cards too dense; added the Models-style disclosure-panel requirement and claimed WS-06.
- Evidence: `EditorToolbarSection.ShortcutCard` currently renders every icon picker, metadata field, execution target, toggle, and remove action in one flat grid, while `ProviderCard` already supplies the controlled sortable `<details>` pattern.
- Remaining: Implement the compact summary/body split, tests, documentation sync, build, deploy, and reload.
- Blockers: None.
- Next action: Reuse the provider disclosure interaction without changing shortcut persistence.

### 2026-07-22 — Amp — disclosure-panel completion

- Changed: Converted every toolbar shortcut into a controlled Models-style disclosure. The compact summary retains identity, status, drag, enable, and remove controls; the expanded body owns icon, target, and metadata configuration. New shortcuts expand automatically, deleted shortcut IDs are removed from local disclosure state, and drag-end clicks are suppressed.
- Evidence: Focused `EditorToolbarSection` tests pass; `npm run typecheck`, `npm run lint -- --no-cache`, `npm run check:boundaries`, `npm run build`, and the full `npm run test -- --runInBand` pass. The final full run reports 286 suites and 2,238 tests passing. Built and deployed artifacts match, Pivi reload reports loaded version 0.14.1, and `obsidian dev:errors` reports no captured errors.
- Remaining: User visual acceptance of the compact shortcut disclosures in the deployed Settings surface.
- Blockers: None.
- Next action: Open Settings > Toolbar and inspect collapsed, expanded, sorting, enable, and remove interactions.

## Completion summary

Toolbar Pivi Command shortcuts now persist an explicit Sidebar or Inline edit target, dispatch through the appropriate existing workflow, and never expose their opaque integration key. Every configured shortcut uses a compact Models-style disclosure whose configuration is local to the expanded body without changing persisted data or sortable behavior. Automated gates, production build, deployment, reload, and runtime error checks pass; only user visual acceptance remains.
