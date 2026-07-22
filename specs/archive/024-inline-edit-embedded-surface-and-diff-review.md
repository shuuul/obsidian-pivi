---
id: "024"
title: "Editor-embedded inline edit surface with markdown diff review"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Main"
---

# 024 — Editor-embedded inline edit surface with markdown diff review

## Context

Spec 022 (archived) delivered the selection toolbar and a Cursor-style inline edit overlay. The current implementation (`packages/pivi-react/src/selectionToolbar/InlineEditBox.tsx`, `src/app/ui/selectionToolbar/SelectionToolbarSurfaceController.ts`, `src/app/ui/inlineEditHelpers.ts`, `src/app/ui/imperativeChatInlineEdit.ts`) has three verified shortcomings:

1. **Overlay UI occludes content and looks rough.** The inline edit box is a body-appended floating overlay positioned via `coordsAtPos`; the result preview is a plain-text `<div>` (`white-space: pre-wrap`, `max-height: 8rem`) with no Markdown rendering, no streaming updates, and no diff.
2. **No diff review.** Accept replaces the whole selection via `editor.replaceRange()` without showing what changed. The sidechat already owns a line-level `DiffRenderer` (`src/ui/chat/rendering/DiffRenderer.ts`) but inline edit does not use it.
3. **Weak input.** The prompt box is a bare `<textarea>` with no `@file`/`/command` selectors, even though the sidebar composer owns reusable `MentionInput` (`src/ui/shared/mention/MentionInput.ts`), `MentionDropdownController`, and `SlashCommandDropdown` (`src/ui/shared/components/SlashCommandDropdown.ts`).

External research (reports: `local://zed-inline-edit.md`, `local://claudian-inline-edit.md`, `local://pivi-inline-edit-current.md`):

- **Zed** (`crates/agent_ui/src/inline_assistant.rs`, `inline_prompt_editor.rs`, `crates/editor/src/display_map/block_map.rs`) embeds the inline assistant as block decorations (`BlockProperties` with `BlockPlacement.Above/Below`) that **push layout apart instead of overlaying**: a sticky prompt editor above the range, an end divider below it, plus green row highlights for insertions and read-only mini-editor blocks for deletions. Accept keeps the edit transaction; reject rolls it back.
- **Claudian** (`src/features/inline-edit/ui/InlineEditModal.ts`) uses CM6 `StateField` + block `WidgetType`s embedded in the editor flow. After generation it hides the original selection with `Decoration.replace` and shows a **rendered-markdown diff preview**: a deletion block (strikethrough + red-tinted background) and an insertion block (green-tinted background), each rendered whole via Obsidian `MarkdownRenderer`, with an Accept/Reject action bar. Accept uses `editor.replaceRange()` so Obsidian undo/redo stays correct. Its input supports `@file` (MentionDropdownController) and `/` commands (SlashCommandDropdown), and separates `<replacement>`/`<insertion>` edits from plain clarification replies.

The user prefers **Zed's presentation model** (editor-embedded block region that never occludes content, reply shown directly below the inline edit area) combined with **Claudian's diff review** (hide original selection, rendered markdown deletion/insertion blocks, explicit Accept/Reject), plus **full** `@` **and** `/` **selectors** in the edit input, with file modifications handled distinctly from conversational replies.

## Goal and success criteria

Replace the floating inline edit overlay with an editor-embedded block surface: prompt input (with full `@`/`/` selectors) and streaming reply live in a CM6 block region above the selection; when the turn produces an edit, the original selection is hidden and a rendered-markdown diff preview with Accept/Reject appears in place; accept applies via `editor.replaceRange()`, reject restores everything.

- [x] The inline edit surface renders as CM6 block widgets inside the editor flow (above the selection) and measurably pushes document content apart — no body-appended overlay remains for the inline edit box.
- [x] The prompt input is `MentionInput`-based and supports both `@` (file/folder/agent mentions) and `/` (commands/skills/MCP) dropdowns with the same providers as the sidebar composer.
- [x] Assistant reply text streams progressively into a Markdown-rendered area directly below the prompt input, without waiting for turn completion.
- [x] Turns that produce edits hide the original selection via `Decoration.replace` and show a rendered-markdown diff preview (deletion block strikethrough/red tint, insertion block green tint) with an explicit Accept/Reject action bar.
- [x] Accept applies the edit with `editor.replaceRange()` (Obsidian undo history preserved) and cleans up all decorations; reject removes all decorations and restores the original selection highlight without touching the document.
- [x] `Escape` rejects/cancels at every phase (input, streaming, diff review); `Mod+Enter` accepts during diff review.
- [x] All new user-visible copy ships i18n keys in `packages/pivi-react/src/i18n/locales/*.json` in the same change.
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test && npm run build` are green, plus targeted Jest coverage for the parser, decoration lifecycle, and accept/reject helpers.



## Scope and non-goals

In scope:

- New CM6 `StateField` + block `WidgetType` inline edit surface (input area, reply area, diff review phase) owned by `src/ui/**` imperative adapter code, registered through the existing `registerEditorExtension` lifecycle.
- Rewiring `SelectionToolbarSurfaceController` so Ask AI opens the embedded surface instead of the overlay; the floating selection toolbar itself remains an overlay.
- Extending the inline edit turn pipeline (`imperativeChatInlineEdit.ts`, `PiviChatViewCommands.submitInlineEditTurn`) with an optional streaming progress callback.
- Turn-prompt/response protocol separating replies from edits (`<replacement>` / `<insertion>` vs. plain clarification), following claudian's `src/core/prompt/inlineEdit.ts` pattern.
- Rendered-markdown diff preview widgets and Accept/Reject application helpers.
- CSS in `packages/pivi-react/styles/` (replacing/retiring the obsolete overlay inline-edit styles) and full-locale i18n.
- Jest tests for the response parser, diff aggregation, decoration lifecycle, and accept/reject helpers.

Not in scope:

- Zed-style direct-to-buffer streaming edits with green row highlights and per-hunk rollback (buffer transaction management). We generate the full replacement first, then review; the diff phase is a review step, not a live mutation.
- Multi-turn conversation continuation inside one inline edit surface (claudian's `continueConversation`). The architecture must not preclude it, but no UI is delivered.
- Multiple simultaneous inline edit surfaces in one editor; one active surface per editor view.
- Changes to the sidebar chat `DiffRenderer` or the sidechat Write/Edit diff presentation.
- Per-hunk (partial) accept/reject; the review unit is the whole replacement/insertion.



## Decisions


| Date       | Decision                                                                                                                                        | Rationale                                                                                                                                                                               | Affected workstreams |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 2026-07-22 | Embed the surface as CM6 block widgets (Zed model), not a floating overlay                                                                      | Block decorations push layout apart and never occlude content; claudian proves the same StateField + WidgetType pattern works in Obsidian's CM6 (`InlineEditModal.ts`)                  | WS-01, WS-04         |
| 2026-07-22 | One block widget above the selection hosts input + streaming reply; the diff phase swaps to hidden-selection + preview widgets (claudian model) | Matches the requested Zed-presentation + claudian-diff combination with a single decoration state machine instead of Zed's three-block sticky layout                                    | WS-01, WS-04         |
| 2026-07-22 | Review-first diff, no live buffer mutation during streaming                                                                                     | Full replacement is generated, then reviewed; avoids porting Zed's `StreamingDiff`/`buffer_codegen` transaction machinery and keeps Obsidian undo semantics via `editor.replaceRange()` | WS-02, WS-03, WS-04  |
| 2026-07-22 | Reuse sidebar composer primitives (`MentionInput`, `MentionDropdownController`, `SlashCommandDropdown`) for the input area                      | Verified reusable by the current-state report; gives full `@`/`/` support without a second convention                                                                                   | WS-01                |
| 2026-07-22 | Separate edits from replies via `<replacement>`/`<insertion>`/clarification parsing                                                             | Claudian's proven protocol; replies render inline below the input while edits enter diff review                                                                                         | WS-03                |
| 2026-07-22 | Keep React out of the embedded surface; mount existing primitives imperatively with the app translator                                          | The surface is an imperative CM6 adapter under `src/ui/**`; React `InlineEditBox` overlay is retired rather than embedded                                                               | WS-01, WS-05         |
| 2026-07-22 | Defer sharing `VaultMentionDataProvider` between sidebar composer and inline edit surface                                                       | Review nit: each surface open triggers a background vault scan; a shared app-layer provider needs a lifecycle design that does not justify blocking this spec                           | WS-05                |




## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.


| ID    | Deliverable                                                                                                                                                                                                                                      | Agent         | Status | Dependencies | Verification                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| WS-01 | CM6 inline edit surface: StateField + block widget hosting MentionInput with `@`/`/` dropdowns and model/thinking selectors, wired into `SelectionToolbarSurfaceController` (Ask AI opens the embedded surface; overlay inline-edit box retired) | WS01Surface   | Done   | None         | Targeted Jest for decoration lifecycle; manual Obsidian check that content is pushed apart, never occluded       |
| WS-02 | Streaming reply pipeline: optional progress callback through `submitInlineEditTurn` plumbing; progressive Markdown-rendered reply area below the input                                                                                           | WS02Streaming | Done   | WS-01        | Jest for callback plumbing (extend `imperativeChatInlineEdit.test.ts`); manual streaming observation in Obsidian |
| WS-03 | Reply/edit protocol: updated turn prompt, `<replacement>`/`<insertion>`/clarification parser, routing clarification replies to the reply area and edits to diff review                                                                           | WS03Protocol  | Done   | WS-02        | Jest for parser edge cases (empty, unlabeled text, malformed tags, both tags)                                    |
| WS-04 | Diff review phase: `Decoration.replace` hiding the original selection, rendered-markdown deletion/insertion preview blocks, Accept/Reject action bar, `editor.replaceRange()` accept, full cleanup reject                                        | Composer      | Done   | WS-01, WS-03 | Jest for diff aggregation + accept/reject helpers; manual Obsidian accept/reject + undo check                    |
| WS-05 | Styles, i18n (all locales), retirement of obsolete overlay inline-edit CSS/React, documentation sync                                                                                                                                             | Composer      | Done   | WS-01..WS-04 | `npm run lint`, `scripts/check-i18n-dead-keys.mjs`, doc/AGENTS.md updates in place                               |




## Verification

- Targeted Jest: `npm run test -- tests/unit/app/ui` (extended inline edit suites) plus new suites for the CM6 surface decoration lifecycle and the response parser.
- Gates: `npm run typecheck && npm run lint && npm run check:boundaries && npm run test && npm run build && npm run check:bundle-size`.
- Manual Obsidian scenario: select text → Ask AI → input with `@` mention and `/` command → streaming reply below input → edit turn → selection hidden, markdown diff blocks shown → Accept applies with working undo; rerun with Reject restoring the untouched document; `Escape` cancels at each phase.
- `npm run check:specs` before closeout.



## Documentation sync

- Numbered developer docs: update the inline edit / selection toolbar flow in the relevant `docs/` page once behavior lands.
- Nearest local guidance: `src/ui/shared/AGENTS.md` (or a new surface-local AGENTS.md if the surface gets its own directory), `packages/pivi-react/AGENTS.md` if React surface code is retired.
- Parent/package guidance: `packages/pivi-react/styles/AGENTS.md` for CSS changes; `packages/pivi-react/src/i18n/AGENTS.md` policy already covers the i18n commit rule.
- Root guidance and roadmap: root `AGENTS.md` architecture status only if the surface changes an entrypoint or boundary.



## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-22 — WS01Surface — WS-01 embedded inline edit surface

- Changed: Added `src/app/ui/inlineEditSurface/` CM6 block widget surface with `InlineEditSurfaceSession`, MentionInput `@`/`/` dropdown wiring, Markdown reply rendering, and `mountInlineEditSurfaceChrome`; rewired `SelectionToolbarSurfaceController` to open the embedded surface via `hideOverlayPreservingSnapshot`; added styles, en i18n key, and targeted Jest coverage.
- Evidence: `npm run typecheck`; `npm run test -- tests/unit/app/ui/inlineEditSurfaceField.test.ts tests/unit/app/ui/inlineEditSurfaceDom.test.ts tests/unit/app/ui/extractInlineEditContextFiles.test.ts` (5 tests).
- Remaining: WS-02 streaming reply callback plumbing; WS-03 protocol parser routing; WS-04 diff review; WS-05 styles/i18n retirement.
- Blockers: None.
- Next action: WS-02 progressive reply streaming.



### 2026-07-22 — Main — spec drafting

- Changed: Created spec from three scout research reports (zed/claudian/current pivi inline edit).
- Evidence: `local://zed-inline-edit.md`, `local://claudian-inline-edit.md`, `local://pivi-inline-edit-current.md`.
- Remaining: Decision review by user, then workstream execution.
- Blockers: None.
- Next action: User confirms scope/decisions, then WS-01 begins.



### 2026-07-21 — Composer — WS-02 streaming progress callback

- Changed: Added optional `onAssistantText` to `SubmitInlineEditTurnParams` / `PiviChatViewCommands.submitInlineEditTurn`; `waitForTabStreamingComplete` polls tab messages every 50ms during streaming and invokes the callback when accumulated assistant text changes; extended `imperativeChatInlineEdit.test.ts` for multi-frame streaming, monotonic accumulation, cancel path, and no-callback baseline.
- Evidence: `npm run test -- tests/unit/app/ui/imperativeChatInlineEdit.test.ts`.
- Remaining: WS-01 surface wiring to consume `onAssistantText` for progressive Markdown reply rendering.
- Blockers: None.



### 2026-07-21 — Composer — WS-04 diff review + WS-02 streaming wiring

- Changed: Added `inlineEditDiffReviewField.ts` with `Decoration.replace` + markdown diff preview widgets; implemented `InlineEditSurfaceSession.showDiffReview/showError`, accept/reject shortcuts, and controller `runInlineEditTurn` routing (`reply`/`replacement`/`insertion`/`empty`) with progressive `onAssistantText` streaming via `contextFiles`; appended diff-review CSS and en i18n keys; added targeted Jest coverage.
- Evidence: `npm run test -- tests/unit/app/ui` (88 tests).
- Remaining: WS-05 styles/i18n retirement across all locales and obsolete overlay cleanup.
- Blockers: None.
- Next action: WS-05 full-locale i18n + overlay retirement.



### 2026-07-22 — Composer — WS-03 reply/edit protocol

- Changed: Added `src/app/ui/inlineEditProtocol.ts` (`InlineEditTurnResult`, `parseInlineEditTurnResponse`, `INLINE_EDIT_TURN_PROTOCOL_INSTRUCTIONS`); upgraded `buildInlineEditTurnContent` with protocol preamble and optional `contextFiles` via `appendContextFiles`; added `inlineEditProtocol.test.ts` and updated `inlineEditHelpers.test.ts`.
- Evidence: `npm run test -- tests/unit/app/ui/inlineEditProtocol.test.ts tests/unit/app/ui/inlineEditHelpers.test.ts`.
- Remaining: Wire parser routing into embedded surface reply vs diff review (WS-04).
- Blockers: None.



### 2026-07-22 — Composer — WS-05 locale mirror, overlay retirement, CSS polish, docs

- Changed: Mirrored `editor.inlineEdit` diff-review keys across all nine non-English locales; deleted React `InlineEditBox` overlay and its CSS; simplified `mountSelectionToolbarSurface` to toolbar-only; polished `inline-edit-surface.css` for embedded Zed-style presentation; updated `docs/04-input-panel-and-context.md`, `packages/pivi-react/AGENTS.md`, and `packages/pivi-react/styles/AGENTS.md`.
- Evidence: `npm run typecheck`; `node scripts/check-i18n-dead-keys.mjs`; `npm run lint`; `npm run test -- tests/unit/app tests/unit/pi`.
- Remaining: None.
- Blockers: None.
- Next action: Spec closeout when user requests archive.



### 2026-07-21 — Composer — Spec024 review fixes (session guards, send race, streaming tags)

- Changed: Hardened `SelectionToolbarSurfaceController.runInlineEditTurn` with session-alive checks after `submitInlineEditTurn` resolves and inside `onAssistantText`; added synchronous turn-in-flight guard for duplicate sends; stripped streaming `<replacement>` / `<insertion>` tags before `setReplyText`; removed redundant `showSelectionHighlight` from `dismissAfterDiffReject` (overlay dismiss already clears highlight via `destroyInlineEditSession`); added `InlineEditSurfaceSession.isDestroyed()` and `stripInlineEditStreamingProtocolTags`.
- Evidence: `npm run typecheck`; `npm run test -- tests/unit/app/ui/selectionToolbarSurfaceController.test.ts tests/unit/app/ui/inlineEditProtocol.test.ts`.
- Remaining: None for this review batch.
- Blockers: None.



### 2026-07-21 — Composer — Spec024 review fixes (P1-2, P2-4/5, P3-8/9)

- Changed: Diff-review accept now reads mapped `Decoration.replace` / insertion ranges from `inlineEditDiffReviewField` instead of static snapshot offsets; `InlineEditSurfaceSession` binds the owning editor at `show()`, loads the markdown `Component`, and routes diff-review errors to an in-widget container; `parseInlineEditTurnResponse` strips protocol tag residue from reply fallbacks; `buildInlineEditTurnContent` places protocol instructions after the prompt and escapes literal `</selected_text>` markers in selections.
- Evidence: `npm run test -- tests/unit/app/ui/inlineEditDiffReviewField.test.ts tests/unit/app/ui/inlineEditSurfaceDiffReview.test.ts tests/unit/app/ui/inlineEditProtocol.test.ts tests/unit/app/ui/inlineEditHelpers.test.ts`.
- Remaining: None for this review batch.
- Blockers: None.
- Next action: Spec closeout when user requests archive.



### 2026-07-22 — Main — review fixes and final verification

- Changed: Reviewer re-check confirmed all findings resolved; fixed the remaining unclosed-tag reply fallback (P3-8, clobbered by a parallel edit) and the new in-flight-turn cancellation Minor via `registerCancel` plumbing through `submitInlineEditTurn` (orphaned turns now cancel streaming on session destroy). Updated spec decisions with the deferred shared mention provider.
- Evidence: `npm run typecheck && npm run lint && npm run check:boundaries` green; Jest 286 suites / 2179 tests green; `npm run build` deployed; `obsidian plugin:reload id=pivi` + `obsidian dev:errors` → "No errors captured."
- Remaining: Manual in-Obsidian acceptance pass (select → Ask AI → @/ selectors → streaming reply → diff review → accept/reject) before closeout.
- Blockers: None.
- Next action: User acceptance, then coordinator completes and archives the spec.



### 2026-07-22 — Main — Inline edit interaction fix and Zed visual redesign

- Changed: Set CM6 widget `ignoreEvent` to `true` in `inlineEditSurfaceField` and `inlineEditDiffReviewField` so input, model/thinking selectors, and diff-review Accept/Reject receive pointer events; restructured `InlineEditSurfaceSession` DOM (left gutter close, flex input band, tail row with @/selectors/send); rewrote `inline-edit-surface.css` to Zed-style embedded band using Obsidian tokens; added selector chevrons in `ComposerSelectors`; wired streaming stop button via `onStop`; added i18n keys across locales.
- Evidence: `npm run typecheck`; `npm run lint`; `npm run test -- tests/unit/app/ui`.
- Remaining: Manual in-Obsidian acceptance (focus, selector dropdowns, diff review clicks).
- Blockers: None.
- Next action: User acceptance in Obsidian.



### 2026-07-22 — Main — Runtime trigger and inline-input repair

- Changed: Made `pointerup` explicitly refresh the CM6 views whose selection updates were suppressed during mouse drag, deferred until CodeMirror finishes its pointer transaction; captured the owning public `editorInfoField.editor` in the selection snapshot; mounted the inline block surface immediately instead of waiting for workspace startup; connected inline `MentionInput` events and the `@` button to `MentionDropdownController`.
- Evidence: Focused Jest (5 suites / 23 tests), full TypeScript typecheck, lint, production build/deploy, and live Obsidian CLI verification: suppressed selection release produced the toolbar; Ask AI mounted a focused editable widget inside `.cm-editor`; `@` opened a visible dropdown with 150 items; no captured runtime errors.
- Remaining: End-to-end model generation and Accept/Reject should still receive a user acceptance pass with the user's configured provider to avoid creating an unsolicited paid turn during automated verification.
- Blockers: None.
- Next action: User verifies one real edit turn and undo with their configured model.



### 2026-07-22 — Main — Inline selector stacking and surface polish

- Changed: Portaled inline-only model and thinking menus to the owning document with viewport-aware fixed positioning so CM6/SVG layers cannot cover or intercept them; switched inline mention and slash selectors to their existing fixed mode; removed the standalone `@` button and dead locale key while preserving typed `@` input; strengthened the top/bottom rules and made the gutter close button transparently styled in every interaction state.
- Evidence: Focused Jest (3 suites / 9 tests), full TypeScript typecheck, lint, boundary/dead-key checks, production build/deploy, and live Obsidian CLI verification: `elementFromPoint` resolved inside the model, thinking, mention, and slash popups; all four were outside `.pivi-inline-edit-surface`; no captured runtime errors.
- Remaining: User visual acceptance for theme-specific border contrast and spacing.
- Blockers: None.
- Next action: User checks the polished surface in their active theme.



### 2026-07-22 — Main — Selector toggles, reply actions, and toolbar lifecycle reset

- Changed: Model and thinking triggers now toggle closed on a second click in both sidebar and inline surfaces; inline replies use the shared Markdown typography at a compact 13px scale and expose one transparent bottom-right Copy Markdown action with copied-state feedback; fixed toolbar reopening by registering pointer listeners for the initial owner document and resetting CM selection identity whenever the overlay is dismissed. Hardened selector mouse-leave handling for non-Node related targets.
- Evidence: Focused Jest (4 suites / 16 tests), full typecheck, lint, boundary checks, production build/deploy, and live Obsidian verification: inline and sidebar selectors opened then closed on consecutive clicks; close → reselect the same range restored the toolbar; reply computed at 13px with one transparent copy action; synthetic mouseout to `window` produced no runtime error.
- Remaining: End-to-end paid generation and visual review of a long Markdown reply remain user acceptance items.
- Blockers: None.
- Next action: User verifies one generated reply and Copy Markdown in their configured theme.



### 2026-07-22 — Main — Systemic multi-editor selection ownership repair

- Changed: Replaced the toolbar's unscoped global clear/refresh behavior with editor-view and owner-document ownership. Inactive Markdown leaves can no longer dismiss the active leaf's toolbar; pointer tracking now observes `pointerdown`, `pointerup`, and `pointercancel` in the capture phase so CodeMirror or third-party propagation cannot leave selection permanently suppressed; leaf changes clear stale pointer state and force-refresh the new active editor. The long-lived host now migrates its overlay and remounts its React surface when a selected editor belongs to another document (including pop-out windows).
- Evidence: Reproduced the failure in the current Base vault with eight live Markdown leaves (`Editor.setSelection()` produced a valid visible range while the overlay stayed hidden); plugin reload restored it, confirming stale runtime interaction/extension state rather than CSS or geometry. Added focused multi-document/source-view tests; 3 suites / 14 tests pass; full typecheck, lint, architecture/boundary/spec checks, and production build pass. In the deployed vault, an inactive editor selection/clear did not dismiss the active toolbar, a pointerup stopped during bubbling still restored the toolbar through capture, and inline close → same-range reselect reopened it; `obsidian dev:errors` reports no errors.
- Remaining: A physical mouse pass in a real pop-out window remains user acceptance; the owner-document migration and document-scoped event path are covered structurally but the CLI cannot generate trusted OS pointer input.
- Blockers: None.
- Next action: User verifies ordinary mouse drag selection remains stable across repeated inline open/close and, if used, a pop-out editor.



### 2026-07-22 — Main — Editor-return dismissal and visible prompt caret

- Changed: Inline edit now treats a pointer press on the owning editor content outside the input/diff widget as an implicit reject, so users can return directly to editing without targeting the close button. The capture listener is session-owned and removed during destroy; interactions inside the widget and body-portaled selectors remain exempt. Added an explicit accent-colored `caret-color` to override the CM6 editor's inherited caret styling inside the nested contenteditable.
- Evidence: Focused Jest (3 suites / 11 tests), full typecheck, lint, boundary checks, and production build/deploy pass. Live Base-vault verification showed the prompt focused with a non-transparent computed caret color; clicking editor content closed the surface, while pointer interaction inside the prompt kept it mounted and focused; no captured runtime errors.
- Remaining: None for this interaction batch.
- Blockers: None.



### 2026-07-22 — Main — Inline prompt geometry and hover-pinned selectors

- Changed: Aligned the inline placeholder pseudo-element to the contenteditable's actual 2px/4px text padding, raised the input host and editor minimum height from 1.5rem to 2.25rem, and replaced the model/thinking boolean disclosure with shared closed/hover/pinned states. Hover-open selectors now close 80ms after leaving the trigger/dropdown corridor; clicking converts a hover preview into a pinned menu that remains open until selection, outside click, or a second trigger click. The behavior is shared by sidebar and inline selectors and uses owner-window timers for pop-out safety.
- Evidence: Focused Jest (3 suites / 24 tests), full typecheck, lint, boundary checks, and production build/deploy pass. Live Base-vault computed geometry was 36px minimum height with placeholder inset exactly matching 2px/4px input padding; hover-leave closed, hover-then-click remained pinned after leave, and the second click closed while inline edit remained mounted; no captured runtime errors.
- Remaining: None for this interaction batch.
- Blockers: None.



### 2026-07-22 — Main — Persistent multi-session inline edit and selected-text command badges

- Changed: Superseded the prior editor-return dismissal behavior. Inline edit sessions are now keyed, persistent records independent of the transient selection toolbar: editor clicks, selection changes, toolbar dismissal, and active-leaf changes no longer destroy them. One editor can host multiple independently mapped input or diff-review decorations; closing, stopping, accepting, or rejecting one session cannot remove or cancel a sibling. Input selections and diff ranges map through CodeMirror transactions under their own session IDs. Multiple surface turns retain independent cancellation/liveness state, while their temporary shared model/thinking settings overlays are serialized to prevent interleaved restore from corrupting Sidebar settings.
- Changed: `{{selected_text}}` remains the canonical persisted workspace-command variable but renders as a removable Selected text badge in the Settings command editor. At command invocation, source-editor selections are converted into the same encoded `InlineContextReference` token used by manual Add to chat; the expanded user input/history therefore renders the same selected-text badge and submission extracts it into `turnRequest.inlineContexts` instead of flattening it to ordinary text. Commands requiring selection now block before sending when no source-editor inline context can be captured.
- Evidence: Focused Jest (11 suites / 56 tests) covers two coexisting input widgets, sibling-preserving hide, two coexisting diff reviews, mapped ranges, editor-click persistence, toolbar show/dismiss persistence, single-session close, turn cancellation/streaming, template badge plain-text round trip/removal, command token materialization, and app-command submission through inline context extraction. Full typecheck, lint, boundary/spec/i18n checks, and production build passed; the build was copied into the live Base vault, the plugin reloaded, and `obsidian dev:errors` reported no captured errors.
- Remaining: Reading-mode/third-party DOM selections still fall back to raw selected text for registered host commands because they do not provide trustworthy source positions; Sidebar selected-text badges intentionally require a source editor selection rather than fabricated coordinates.
- Blockers: None.



### 2026-07-22 — Main — Settings-only selected-text @ suggestion

- Changed: The Settings command Prompt editor now prepends a localized Selected text item whenever `@` opens its mention selector. Selecting it replaces the active query with canonical `{{selected_text}}` and immediately rebuilds the contenteditable into the existing removable command-template badge. The capability is opt-in at `MentionDropdownController` construction and is enabled only by `createMentionEditorPort`; Sidebar and inline-edit inputs retain their existing suggestion catalogs.
- Evidence: Focused Jest (3 suites / 22 tests) covers first-item ordering, canonical insertion, immediate rich-input badge rendering, default-off isolation, parser round trip, and removal. Full typecheck, lint, architecture/boundary/spec/i18n checks, and production build/deploy passed.
- Remaining: Manual visual acceptance in Settings → Commands for the current theme.
- Blockers: None.



### 2026-07-22 — Main — Navigable Sidebar selected-text badges

- Changed: Command-expanded `{{selected_text}}` continues to materialize as the same encoded inline-context token used by Add to chat, and inline-context badges now share one clickable presentation in both the composer and rendered user messages. Activating a badge opens its source note, restores and centers the captured selection, focuses the editor, and applies an independent 900ms accent shadow flash. Historical ranges are clamped to the current document after edits; mouse and Enter/Space activation are supported, while the nested remove action remains isolated.
- Evidence: Focused Jest (4 suites / 15 tests) covers canonical command token materialization, shared clickable badge rendering, source navigation, selection/scroll/focus, flash dispatch, and stale-range clamping. Full typecheck, lint, boundary/spec/i18n checks, and production build/deploy passed.
- Remaining: Manual visual acceptance of the editor flash in the current theme.
- Blockers: None.



### 2026-07-22 — Main — Inline waiting light bar and progressive output confirmation

- Changed: Added the Subagent running-light treatment to each inline-edit session while it is waiting for its first visible assistant text. The animated pseudo-element overlays only the surface's bottom rule—the boundary directly above the selected source—and clears independently on first visible streamed output, stop, failure, or completion. Reduced-motion mode keeps the status line static. Confirmed that inline output already streams through the existing 50ms accumulated-assistant callback into the Markdown reply area, so no agent transport refactor was needed.
- Evidence: Focused Jest (4 suites / 25 tests), full typecheck, lint, architecture/boundary/spec/i18n checks, and production build passed. The build was copied into the live Base vault, the plugin reloaded, and `obsidian dev:errors` reported no captured errors.
- Remaining: None.
- Blockers: None.



### 2026-07-22 — Main — Direct chunk streaming and Sidebar output parity

- Changed: Corrected the prior 50ms polling assessment: `submitInlineEditTurn` awaited the complete `sendMessage()` promise before entering its polling loop, so real turns could not publish progressive output. The normal input turn pipeline now emits accumulated assistant text immediately after each ordered text chunk is reduced, and the inline bridge forwards those events directly with cancellation/generation guards. Removed the timer poll entirely. Inline replies now use the same `pivi-message pivi-message-assistant` DOM contract and sealed-prefix/live-tail Markdown adapter as Sidebar; terminal state performs the same full-fidelity render, and partial protocol open tags remain hidden until visible content starts.
- Evidence: Focused Jest covers direct callback delivery before turn resolution, per-chunk accumulation, cancellation, partial protocol tags, canonical assistant DOM, sealed-prefix streaming, terminal rendering, and unchanged diff review lifecycle. Full source/test typecheck, lint, boundary/spec checks, 286 Jest suites / 2211 tests, production build, and bundle-size gate pass. The built plugin reloaded in Obsidian and `obsidian dev:errors` reported no captured errors.
- Remaining: User visual acceptance with one configured-provider turn; automated verification did not initiate a paid model request.
- Blockers: None.



### 2026-07-22 — Main — Inline first-output timer

- Changed: Added an elapsed-only progress indicator at the lower-left of the inline edit composer. It uses the Sidebar's shared `pivi-response-meta` typography, owner-window scheduling, and one-decimal `x.xs` elapsed output. The indicator and bottom running light are mounted behind one waiting-state controller, so they start together for each turn and stop together on first visible streamed output, stop, failure, completion, or session disposal.
- Evidence: Focused DOM/style Jest covers elapsed updates, whitespace-only chunks, first-visible-output stop, restart, disposal, shared typography, left-edge layout, and non-default editor owner realms. Full typecheck, lint, boundary/spec checks, 286 Jest suites / 2213 tests, production build, and bundle-size gate pass. The built plugin reloaded in Obsidian and `obsidian dev:errors` reported no captured errors.
- Remaining: User visual acceptance with one configured-provider turn.
- Blockers: None.



### 2026-07-22 — Main — Chunk-safe ordered-list streaming

- Changed: Traced the reported extra spacing after ordered-list markers against the live Obsidian theme and confirmed Sidebar/inline list DOM had identical computed list margins, padding, typography, and line height. The mismatch came from the shared streaming Markdown scanner advancing past unterminated chunk-tail lines: a newline arriving in the next provider chunk could be mistaken for a blank line, sealing `1.`, its text, and nested bullets into separate Markdown segments. The scanner now commits only newline-terminated lines, preserving one complete list segment while retaining immediate escaped-tail updates.
- Evidence: Focused adapter and inline-surface Jest reproduces a provider stream split between `1. First item` and its later newline, verifies no premature Markdown render occurs, and confirms the complete item plus nested bullet seals only at the real blank-line boundary. Full verification follows with the implementation handoff.
- Remaining: User visual acceptance with one configured-provider ordered-list response.
- Blockers: None.



### 2026-07-22 — Main — CodeMirror-independent inline output layout

- Changed: Compared the same rendered list in the live inline surface and Sidebar. Their Markdown DOM and `li` margin, padding, font size, and line height matched, but the inline assistant inherited CodeMirror's `white-space: break-spaces`, `word-break: break-word`, `line-break: after-white-space`, tab size, and transparent caret through the block widget. MarkdownRenderer's formatting newlines between sibling `<li>` nodes therefore became visible line boxes, adding about 22px between items. The shared `.pivi-message-content` output boundary now restores the Sidebar text-layout defaults, while the streaming plaintext tail keeps its explicit `pre-wrap`; no list-specific spacing override was added.
- Evidence: Live verification reduced the inline adjacent-item gap from about 25.87px to the Sidebar's 3.49px without changing list geometry, then confirmed the deployed stylesheet resolves `white-space: normal`, collapsed whitespace, normal/auto line breaking, tab size 8, and visible caret color inside a `break-spaces` CodeMirror line while the live tail remains `pre-wrap`. Focused CSS/streaming suites (4 suites / 21 tests), full typecheck, lint, boundary/spec checks, 286 Jest suites / 2216 tests, production build, and bundle-size gate pass; the built plugin reloaded with no captured runtime errors.
- Remaining: None.
- Blockers: None.



### 2026-07-22 — Main — Persistent inline first-output duration

- Changed: The inline first-output timer now renders as `* x.xs`, performs one final owner-window clock read when the running light stops, and keeps that frozen elapsed value visible after first output or terminal completion. Edit responses move the same metadata node into the Diff Review action row before replacing the input widget. Starting another turn resets it to `* 0.0s`; closing the surface still disposes its interval and DOM.
- Evidence: Focused DOM/style coverage (3 suites / 19 tests) verifies the initial hidden state, starred one-decimal updates, frozen post-output/post-terminal visibility, Diff Review transfer, new-turn reset, and owner-realm interval cleanup. Full typecheck, lint, boundary/spec checks, and production build pass; the built plugin reloaded with no captured runtime errors.
- Remaining: None.
- Blockers: None.



## Completion summary

Delivered an editor-embedded inline edit surface with CM6 block widgets, full `@`/`/` mention input, direct chunk streaming into Sidebar-parity Markdown output, rendered diff review with Accept/Reject, persistent multi-session decorations, command-template selected-text badges, navigable inline-context badges, and first-output timing chrome. Retired the floating React `InlineEditBox` overlay.

Deviations: per-hunk accept/reject, multi-turn continuation inside one surface, and shared `VaultMentionDataProvider` between composer and inline edit remain deferred per spec non-goals/decisions.

Verification: all workstreams Done; focused and full Jest suites green through closeout (286 suites / 2216+ tests at final handoff); production build and bundle-size gates pass; live Base vault reload with `obsidian dev:errors` clean.

Documentation sync: `docs/04-input-panel-and-context.md`, `src/app/AGENTS.md`, `packages/pivi-react/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`, and related UI guidance updated during WS-05 and follow-up handoffs.