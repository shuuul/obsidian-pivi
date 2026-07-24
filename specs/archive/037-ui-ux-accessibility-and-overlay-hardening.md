---
id: "037"
title: "UI/UX accessibility and overlay hardening"
status: Completed
created: 2026-07-24
updated: 2026-07-24
coordinator: "Amp"
---

# 037 — UI/UX accessibility and overlay hardening

## Context

The v0.15.1 UI/UX report was re-audited against the current working tree rather than accepted from its historical line numbers. Its central conclusion still holds: Pivi already has a strong host-theme contract and broad reduced-motion/transparency/contrast support, but several keyboard, focus, overlay-lifecycle, destructive-action, and semantic-color gaps remain. One reported P0 is already fixed, several findings are partial, and three recommendations conflict with or duplicate intentional current architecture.

### Verified triage

`Present` means the reported user-facing failure is still reproducible from the current implementation. `Partial` means related safeguards exist but do not close the report. `Fixed` requires no work in this spec. `Defer` is a product preference or contradicts an intentional invariant and is explicitly outside this spec.

| # | Current verdict | Current evidence and disposition |
|---|---|---|
| 1 | Fixed | `src/ui/shared/selectionToolbar/floatingOverlay.ts:45-58` checks visibility before consuming Escape; retain the regression test. |
| 2 | Present | `src/app/editorSelectionToolbarRegistration.ts:141-184` repositions from the captured `snapshot.rect`; recompute live selection geometry or dismiss when no valid selection remains. |
| 3 | Present | `src/app/ui/selectionToolbar/SelectionToolbarSurfaceController.ts:324-360` dismisses ordinary toolbar actions without restoring editor focus. |
| 4 | Partial | `packages/pivi-react/src/mount/composer/ComposerSelectors.tsx:28-164` has hover-preview/click-pinned behavior, but model/thinking menus still lack Escape and complete listbox keyboard semantics. |
| 5 | Present | `packages/pivi-react/src/mount/tab-bar/ChatTabBar.tsx:167-184,234-274` reveals archived rows only by wheel and excludes them from keyboard traversal before reveal. |
| 6 | Present | `AddProviderPicker.tsx:58-81` and `McpToolsSection.tsx:87-98` still use clickable, unfocusable `div` options. |
| 7 | Present | Provider and command confirmations still lack a shared initial-focus, Escape, containment, and trigger-focus-restoration contract; MCP import implements only part of it. |
| 8 | Partial | `InlineAskUserQuestion.ts:92-104` always focuses and smooth-scrolls on render, including when another editable owns focus. Option-click keyboard continuity is not the primary remaining defect because the focused root usually remains active. |
| 9 | Present | `input.css:25-34` has no input-wrapper `:focus-within` ring and `messages.css:71-73` removes the focused transcript outline without a replacement. |
| 10 | Present | `SlashCommandDropdown.ts:136-210` has no outside-pointer dismissal listener. |
| 11 | Present | Slash and mention dropdowns compute cursor geometry but do not subscribe to owner viewport/container scroll to recompute or dismiss. |
| 12 | Present | `InlineEditKeyboardController.ts:12-42` handles Escape only during diff review, not prompt input. |
| 13 | Present | `editorSelectionToolbarRegistration.ts:263-300` deliberately disables drag suppression in Source mode. |
| 14 | Present | `MentionDropdownController.ts:118-185` cancels debounce on destroy but not hide, so Escape can be followed by a delayed reopen. |
| 15 | Present | `slash-commands.css:155-176` keeps details at `left: 100%`; narrow width collapses instead of flipping or stacking. |
| 16 | Present | `McpToolsSection.tsx:160-175` renders delete confirmation as an unlayered dialog with no keyboard/focus lifecycle. |
| 17 | Present | Skill-folder removal and deleted-session-file purge execute without confirmation; both are durable destructive actions. |
| 18 | Partial | Environment entries are now structured and secret-aware, but `SimpleSettingsTabs.tsx:58-140` still commits through debounce/blur without an explicit apply boundary for removals. |
| 19 | Partial | The MCP add editor is intentionally inline per the package architecture, but opening it does not focus or bring its first field into view. Keep it inline; add focus and scroll visibility rather than inventing a modal. |
| 20 | Fixed | Settings now expose seven primary tabs including dedicated Subagents, Commands, and Toolbar pages; General's current grouping is acceptable and further splitting is a product-information-architecture choice. |
| 21 | Partial | Shared controls generally have accessible names, but `SettingRow` text is not universally programmatically associated with its control. Require a usable accessible name for every control; do not require all row text to become a clickable `<label>` where that would create nested-label or multi-control ambiguity. |
| 22 | Partial | Shared settings primitives have narrow breakpoints, but MCP/editor/card and remaining fixed-grid layouts still overflow or compress poorly. |
| 23 | Present | Message actions are 16px, tab actions 20px, and send 24px. Increase hit boxes without enlarging icons; add coarse-pointer sizing. |
| 24 | Present | `mount/tab-bar/constants.ts:5` still sets tab tooltips to 3000ms. |
| 25 | Present | `model-selector.css:103` and `external-context.css:85` still use 8px group labels. |
| 26 | Present | `ComposerChrome.tsx:43-70` leaves `title` on a natively disabled button; disabled controls do not reliably receive hover events for tooltips. |
| 27 | Defer | The one-third tool disclosure cap and direct-body scroll owner are intentional virtual-transcript invariants documented in `packages/pivi-react/AGENTS.md`; nested disclosures already reuse that owner and scroll chaining is supported. Revisit only with measured usability evidence. |
| 28 | Present | `MessageView.tsx:49-80` uses click-only images and nonsemantic lightbox/close `div`s; Escape exists but dialog focus lifecycle does not. |
| 29 | Present | `EditableTabTitle.tsx:30-56` does not sanitize rich or multiline paste before it enters the contenteditable DOM. |
| 30 | Defer | Date separators are a product preference that adds virtual rows and transcript noise. Do not add them without a separate product decision and a setting/default decision. |
| 31 | Partial | Ask-user submit/review copy is localized, but title, hints, option fallbacks, and stored waiting/result copy remain hard-coded English. |
| 32 | Present | Ask-user options display numeric prefixes while `inlineAskUserQuestionKeys.ts:56-172` has no digit selection. Implement guarded 1–9 shortcuts rather than remove useful numbering. |
| 33 | Present | `EditorToolbarSection.tsx:190-247` silently slices command matches to 100. |
| 34 | Misframed/partial | Unavailable states are not globally red. Restrict changes to external-context missing-path/error indicators: warning/neutral for unavailable, error only for an action-blocking failure. |
| 35 | Partial | Skills use one safe global mutation lock and notify failures, but expose no action-specific pending or success feedback. Preserve serialization; improve feedback rather than enabling concurrent mutations. |

### Verified theme debt

The report's exact literals remain in the CSS source: legacy `--pivi-brand`, `--pivi-error`, and unused `--pivi-compact`; `#7abaff`; `#f472b6`; white selection alpha; `#d45d5d`; three `#E57373` values; two Material-green badge backgrounds; and literal diff red/green backgrounds. Interactive use of `--pivi-brand` also extends beyond the original report into external-context, image-drop, and loading/inline-edit accents. The host mapping already exposes accent, error, success, warning, selection, red, green, and RGB variants in `packages/obsidian-host/styles/pivi-theme.css`.

This spec distinguishes semantic theme debt from deliberate compositing. Neutral black-alpha shadows, backdrops, code surfaces, and the standalone OAuth callback page are not theme leaks and must not be mechanically replaced.

## Goal and success criteria

Close the verified high-value UI/UX gaps while preserving Pivi's current visual direction, React/imperative ownership boundaries, owner-realm behavior, and Obsidian theme integration.

- [x] Escape, outside pointer, scroll, and focus behavior for selection toolbar, inline edit, slash, mention, and composer selectors is deterministic and covered by owner-realm behavior tests.
- [x] Every menu option and primary settings action in scope is keyboard reachable and operable; listbox/menu/dialog semantics match actual interaction behavior.
- [x] Every modal confirmation in scope has an accessible name, conservative initial focus, Escape dismissal where safe, focus containment, and trigger-focus restoration.
- [x] Skill removal, deleted-session purge, and environment-entry removals require an explicit review/confirmation boundary before durable deletion.
- [x] Ask-user interaction does not steal focus from another active editable, supports guarded 1–9 option shortcuts, and contains no hard-coded product chrome English.
- [x] Chat input, transcript-navigation focus, images/lightbox, archived tabs, tab-title editing, and command truncation have visible and keyboard-complete behavior.
- [x] In-scope pointer targets are at least 32×32 CSS px on compact fine-pointer desktop surfaces and at least 44×44 CSS px under coarse-pointer media queries, while icon size and visual density remain unchanged.
- [x] Semantic UI colors in Pivi's themed surface use `--pivi-host-*` tokens or `color-mix()` from them; `--pivi-compact` is removed if still unused, and brand color remains only in genuinely branded assets rather than interaction/error/status state.
- [x] Narrow settings and slash surfaces fit without clipped controls or inaccessible detail content at 320–520px container/viewport widths.
- [x] All new or changed user-visible copy and ARIA text is translated in every locale in the same workstream.
- [x] Focused tests, `npm run check:i18n-dead-keys`, `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run test:coverage`, `npm run build`, `npm run check:bundle-size`, and `npm run check:specs` pass before closeout.
- [x] Live Obsidian QA passes in the main window and one pop-out using both a light and dark theme, with `obsidian dev:errors` reporting no new errors.

## Scope and non-goals

In scope:

- Current report items #2–#19, #21–#26, #28–#29, #31–#33, and the narrowly corrected portions of #34–#35.
- Regression preservation for already-fixed #1 and #20 where adjacent code changes occur.
- Host-token migration for semantic colors and interactive brand-token misuse across current Pivi themed CSS, not only the report's original ten literals.
- Focus/keyboard behavior implemented in the owning React component or imperative adapter; shared primitives only where at least two current consumers need the same lifecycle.
- Targeted responsive treatment for current overflow/compression failures.

Not in scope:

- A visual redesign, new palette, typography direction, or replacement of Obsidian theme variables.
- Date separators (#30), disclosure-height redesign or “expand all” (#27), or another General-settings information-architecture pass (#20).
- Mechanical replacement of neutral alpha shadows/backdrops/code backgrounds or colors in standalone browser pages outside the Obsidian themed surface.
- Replacing the intentionally inline MCP editor with a modal, or enabling concurrent Skills mutations merely to avoid a global busy lock.
- Migrating every settings row to Obsidian's imperative `Setting` API; settings remain React-owned.
- Changing runtime, persistence schemas, provider behavior, chat projection architecture, or the single-scroll-owner disclosure invariant.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-24 | Prioritize host behavior and WCAG-style keyboard/focus completeness over optional polish; explicitly defer #27 and #30 and treat #20 as already resolved. | Prevents preference work from obscuring user-blocking regressions and preserves documented virtual-transcript/settings architecture. | All |
| 2026-07-24 | Keep composer model/thinking hover preview plus click pinning, but add Escape and Arrow/Home/End/Enter behavior with one coherent listbox contract. | Hover preview is now a documented product interaction; removing it would change visual/interaction direction rather than harden it. | WS-02 |
| 2026-07-24 | On selection-toolbar scroll, recompute live geometry when possible and dismiss if the selection is invalid/outside the editor; never keep using a stale captured rectangle. | Reanchoring preserves utility while dismissal is safer than displaying over unrelated text. | WS-01 |
| 2026-07-24 | Restore editor focus after toolbar command dispatch, except when the action intentionally opens and focuses another durable surface. | Preserves normal typing continuity without stealing focus back from a newly opened input/modal. | WS-01 |
| 2026-07-24 | Use native `<button>` elements for actionable picker/options where the interaction is command-like; use listbox/option only for true single-selection widgets. | Native controls provide keyboard and disabled semantics with less custom event code. | WS-02, WS-04 |
| 2026-07-24 | Modal initial focus goes to Cancel for destructive confirmations and the first editable field for input/import dialogs; close restores the exact connected trigger when possible. | Conservative destructive default and predictable keyboard return path. | WS-04 |
| 2026-07-24 | Preserve the inline MCP editor and scroll/focus its first field on open. | Package guidance explicitly defines MCP editing as inline; the defect is invisible placement, not lack of a modal. | WS-04 |
| 2026-07-24 | Environment changes may be drafted freely, but durable removals are applied only through an explicit review/save action; secret values remain non-echoing and existing source-aware validation remains authoritative. | Closes accidental blur/debounce deletion without weakening current secure-storage behavior. | WS-04 |
| 2026-07-24 | Keep Skills operations serialized; expose operation-specific pending text and success feedback instead of row-level concurrent mutation. | Global serialization prevents races in filesystem-backed install/update/remove operations. | WS-04 |
| 2026-07-24 | Preserve `--pivi-brand` only for true brand assets if such uses remain. Accent, selected, loading, drop-target, mention, mode, context, status, error, success, warning, selection, and diff semantics derive from `--pivi-host-*`. | User themes should control interactive semantics; neutral compositing literals remain valid. | WS-05 |
| 2026-07-24 | Accessible settings association means every control has a programmatic name and relevant description, not that every multi-control `SettingRow` becomes a wrapping label. | Avoids invalid nested labels and accidental row-click activation while meeting assistive-technology needs. | WS-04 |
| 2026-07-24 | Numeric ask-user shortcuts apply only to 1–9 when the root owns focus, no text input/contenteditable owns focus, and no IME composition is active. | Makes visible numbering useful without intercepting text entry. | WS-03 |
| 2026-07-24 | Fine-pointer targets use a compact 32px minimum; coarse-pointer targets use 44px. Icons retain current dimensions. | Improves hit testing without changing the established dense desktop visual direction. | WS-06 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Editor overlay correctness: live scroll geometry/dismiss, focus restoration, input Escape, Source-mode drag suppression, and regression coverage for invisible-overlay Escape pass-through. | Unassigned | Done | None | Focused selection-toolbar/inline-edit Jest suites; manual LP + Source selection, scroll, Escape, command typing continuation. |
| WS-02 | Composer and cursor dropdown contract: model/thinking Escape + roving selection semantics, slash outside-dismiss and scroll anchoring, mention debounce cancellation/scroll anchoring, and responsive slash detail flip/stack. | Unassigned | Done | None | React + imperative dropdown tests in non-default owner realm; manual narrow sidebar and scroll QA. |
| WS-03 | Chat keyboard/focus completion: archived reveal control, ask-user conditional focus + 1–9 keys + i18n, input/transcript focus indicators, image lightbox dialog lifecycle, tab paste normalization, command truncation notice, and disabled-send tooltip wrapper. | Unassigned | Done | WS-07 for shared dialog expectations only if the lightbox adopts it | Focused chat/React tests, locale parity/dead-key checks, keyboard-only manual flow. |
| WS-04 | Settings safety/accessibility: native picker options, consistent confirmation lifecycle, destructive confirmations, environment explicit apply/review, inline MCP autofocus/scroll, control naming/descriptions, responsive settings layouts, and Skills pending/success feedback. | Unassigned | Done | WS-07 | Focused settings React tests; keyboard-only add/remove/import/edit flows at narrow widths. |
| WS-05 | Theme-token closure: replace semantic literals and non-brand `--pivi-brand` uses with host tokens/`color-mix`, remove dead legacy tokens, and add a source-level guard or focused CSS assertion for forbidden legacy literals. | Unassigned | Done | None | `npm run build:css`; literal/token scan; light/dark/high-contrast manual QA. |
| WS-06 | Dense-control polish: pointer target sizing, tooltip delay, 8px group-label correction, and narrowly corrected unavailable/warning semantics. | Unassigned | Done | WS-05 for final semantic tokens | CSS build plus fine/coarse-pointer and light/dark visual QA. |
| WS-07 | Minimal reusable focus lifecycle for React-owned modal layers, adopted by provider, command, MCP import/delete, destructive settings confirmations, and optionally lightbox if the ownership fit is clean. Do not create a framework beyond current consumers. | Unassigned | Done | None | Shared behavior tests: initial focus, Tab/Shift+Tab containment, Escape, backdrop, restore, unmount cleanup, owner document. |
| WS-08 | Integration, durable docs sync, full gates, and live Obsidian matrix. | Unassigned | Done | WS-01..WS-07 | Full command chain and manual protocol below. |

## Verification

Focused automated checks must be chosen from the actual touched paths, with at least these behavior scenarios represented:

- Selection overlay: invisible Escape reaches the host; visible Escape dismisses; scroll uses new geometry or dismisses; Source-mode pointer drag does not flash; ordinary action returns focus and immediate typing reaches CodeMirror.
- Dropdowns: Escape closes only the active Pivi surface; Arrow/Home/End moves the active option; Enter selects; outside pointer closes slash; hide cancels pending mention open; owner scroll repositions/dismisses; narrow detail remains readable.
- Modal/dialog: owner-document focus, conservative initial target, Tab wrap in both directions, Escape/backdrop policy, exact trigger restoration, and cleanup if the trigger or dialog unmounts.
- Ask-user: rendering does not steal focus from composer/another editable; keyboard flow still works when intentionally focused; digits are ignored in inputs and during composition; all chrome uses the translator.
- Settings: Provider/MCP add works by keyboard; destructive actions require confirmation; environment removal is not persisted by blur alone; MCP add editor is visible and focused; controls have accessible names/descriptions; 320px and 520px layouts retain all actions.
- Chat details: archived rows are keyboard discoverable, transcript focus is visible, disabled Send explains itself, lightbox opens/closes/restores focus by keyboard, multiline/rich title paste becomes one plain-text line, and truncated command results announce the actual count.
- Theme: no listed legacy literals remain in Pivi's themed CSS; interactive states follow two materially different Obsidian accent colors; error/success/warning/selection/diff remain distinguishable in light, dark, and high-contrast modes.

Commands before closeout:

```bash
npm run check:i18n-dead-keys
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
npm run check:bundle-size
npm run check:specs
obsidian plugin:reload id=pivi
obsidian dev:errors
```

Manual live-vault matrix:

1. Main window and one pop-out Markdown editor.
2. Live Preview and Source mode.
3. Keyboard-only and pointer flows.
4. One light theme and one dark theme with different accent colors; repeat critical state checks with increased contrast enabled when supported.
5. Sidebar widths around 320px, 420px, and 520px.
6. Verify host Escape behavior (search/completion/Vim where installed) remains unchanged whenever no visible Pivi overlay owns Escape.

## Documentation sync

- Numbered developer docs: update `docs/04-input-panel-and-context.md`, `docs/05-tabs-sessions-and-history.md`, and `docs/08-presentation-and-settings.md` for lasting interaction/focus/destructive-action behavior; update another numbered page only if its existing contract is directly changed.
- Nearest local guidance: update `src/ui/shared/AGENTS.md`, `src/ui/chat/rendering/AGENTS.md`, and `src/app/AGENTS.md` only where maps or durable overlay rules change.
- Parent/package guidance: update `packages/pivi-react/AGENTS.md` for durable menu/modal/settings/theme invariants and `packages/pivi-react/styles/AGENTS.md` if token or target-size conventions become enforceable.
- Root guidance and roadmap: update root `AGENTS.md` only if the cross-cutting architecture/status summary becomes inaccurate; record shipped UI hardening in `docs/10-roadmap-release-and-maintenance.md` at closeout if that page tracks the release milestone.

## Progress and handoff

### 2026-07-24 — Amp — audit and draft

- Changed: Re-audited all 35 report findings and the hard-coded color inventory against v0.15.1; created this decision-complete Draft and added it to the active-spec index.
- Evidence: Direct source reads plus targeted searches across `src/app`, `src/ui`, `packages/pivi-react`, and `packages/obsidian-host`; audit verdicts and current line ranges are recorded in Context.
- Remaining: User review; after approval set status to Active, assign independent workstreams, and implement WS-01/WS-05 first because they are bounded and unblock reliable live QA.
- Blockers: None. #27 and #30 require separate product evidence/decisions and are intentionally not blockers.
- Next action: Confirm scope, activate the spec, then claim workstreams before editing implementation files.

### 2026-07-24 — implementation and closeout

- Changed: Delivered WS-01 through WS-08 across editor overlays, composer/cursor dropdowns, chat keyboard/focus, settings safety, theme-token closure, dense-control polish, shared `ModalLayer`, and documentation sync.
- Evidence: Focused Jest coverage in `tests/pivi-react/ModalLayer.test.tsx`, `ComposerSelectors.test.tsx`, `floatingOverlay.test.ts`, `inlineAskUserQuestionKeys.test.ts`, `themeTokens.test.ts`, and related React/settings suites; `npm run check:i18n-dead-keys`, `typecheck`, `lint`, `check:boundaries`, `test:coverage`, `build`, `check:bundle-size`, and `check:specs` green; live Obsidian reload with `obsidian dev:errors` clean in main and pop-out windows.
- Remaining: None. Deferred items #27 and #30 remain product decisions outside this spec.
- Blockers: None.
- Next action: Archive spec and keep numbered docs / nearest `AGENTS.md` files current.

## Completion summary

Spec 037 closed the verified v0.15.1 UI/UX accessibility and overlay gaps without changing Pivi's visual direction or ownership boundaries.

Delivered behavior:

- Deterministic overlay lifecycle for selection toolbar, inline edit, slash, mention, and composer selectors, including invisible Escape pass-through, outside-pointer dismiss, owner-scroll reposition/dismiss, and editor focus restoration after ordinary toolbar actions.
- Composer model/thinking `listbox` menus with hover preview plus click pinning, Escape/Arrow/Home/End/Enter semantics, and outside-pointer close.
- Shared React `ModalLayer` / `useModalLayer` for provider/command/MCP/destructive confirmations and the message image lightbox, with conservative initial focus and trigger restoration.
- Explicit environment **Apply** review, destructive confirmations for skill removal and deleted-session purge, native settings picker buttons, and inline MCP editor autofocus/scroll.
- Ask-user conditional focus, guarded 1–9 option shortcuts, full locale coverage, transcript/input focus rings, keyboard archived-tab reveal, tab-title paste normalization, command-match truncation notice, and disabled-send tooltip wrapper.
- Host-token semantic color migration guarded by `tests/unit/scripts/themeTokens.test.ts`, compact 32px / coarse 44px pointer targets, 500 ms tab tooltips, and warning-neutral external-context unavailable semantics.

Deferred unchanged: date separators (#30) and disclosure-height redesign (#27).

Documentation synchronized into `docs/04-input-panel-and-context.md`, `docs/05-tabs-sessions-and-history.md`, `docs/08-presentation-and-settings.md`, `docs/10-roadmap-release-and-maintenance.md`, `src/ui/shared/AGENTS.md`, `packages/pivi-react/AGENTS.md`, and `packages/pivi-react/styles/AGENTS.md`.
