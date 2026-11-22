---
id: "053"
title: "Composer mention badge clamp and copy-paste round trip"
status: Completed
created: 2026-09-07
updated: 2026-11-22
coordinator: "Amp thread T-01a079d5-2a79-716b-b12b-4d9db7eadf8c"
---

# 053 — Composer mention badge clamp and copy-paste round trip

## Context

Input-panel `@` and `/` tokens render as non-editable inline mention badges (`span.pivi-context-badge--inline` with canonical text in `data-mention-token`). Visible labels are presentation only: file badges show the basename, slash badges drop the leading `/`.

Two user-visible gaps:

- Long labels have ellipsis CSS, but the badge itself is only capped at `max-width: 100%`, so a long path still occupies the full composer line.
- There is no copy/cut handler. Browser copy serializes visible label text. Paste in [`MentionInput.handlePaste`](../../src/ui/shared/mention/MentionInput.ts) inserts `text/plain` and re-parses, so a copied badge pastes as ordinary words and does not rebuild.

Verified owners: [`MentionInput`](../../src/ui/shared/mention/MentionInput.ts) (composer + Settings command Prompt editor), [`inlineMentionBadgeDom.ts`](../../src/ui/shared/mention/inlineMentionBadgeDom.ts), [`mention-badges.css`](../../packages/pivi-react/styles/components/mention-badges.css). Parser stays in `@pivi/agent/context/mentions`.

## Goal and success criteria

Inline mention badges stay compact, and copy/paste of those badges inside a mention input rebuilds the same badges from canonical tokens.

- [x] Composer and Settings mention-editor inline badges cap at `min(100%, 24ch)` with label ellipsis; the full path/token remains on `title`.
- [x] Copy or cut from a mention input writes canonical `data-mention-token` text (`@path`, `/skill`, `/generate-image`, `{{selected_text}}`, inline-context tokens) rather than visible labels.
- [x] Paste of that canonical text into the same mention input rebuilds matching inline badges; `ComposerInput.value` is unchanged from the copied string.
- [x] Unknown or label-only pasted text stays plain text (no invented badges).
- [x] Focused jsdom tests cover copy serialization and paste rebuild; CSS contract test locks the 24ch cap.
- [x] Human visual sign-off: long file/folder/skill badges in the composer, a sent user message, and Settings → Commands Prompt editor, light and dark.

## Scope and non-goals

In scope:

- CSS clamp for `.pivi-context-badge--inline` (composer, history mention text, Settings mention editor).
- Copy/cut serialization and existing plain-text paste rebuild on `MentionInput` (chat composer and Settings command Prompt editor).
- Docs in `docs/04-input-panel-and-context.md` plus nearest `AGENTS.md` files.

Not in scope:

- Mention parser / token grammar changes.
- HTML clipboard payloads.
- Copy handlers on historical user-message badges (paste of history copy remains label text unless the clipboard already holds canonical tokens).
- Current-note file chips, image paste, or non-inline `button.pivi-context-badge` chips.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-07 | Cap inline badges at `max-width: min(100%, 24ch)`. | User-approved default; `100%` still wins in a narrow composer; `ch` tracks label text rather than a px guess. | WS-01 |
| 2026-09-07 | Copy/cut writes `text/plain` canonical tokens only; no `text/html`. | Paste already inserts plain text and re-parses; HTML would fight that sanitizer and leak badge DOM. | WS-02 |
| 2026-09-07 | Attach copy/cut on `MentionInput` itself; leave paste wiring on consumers. | Settings and composer share the class; paste must still yield to image interception in `tabInputWiring`. | WS-02 |
| 2026-09-07 | A selection that intersects a badge copies the whole token. | Badges are atomic (`contenteditable=false`); partial label copy would drop the token and fail rebuild. | WS-02 |
| 2026-09-07 | Visual-side-effect: 24ch clamp plus ellipsis on composer, history, and Settings mention badges. | Textbook overflow rules can look cramped on long CJK labels; human sign-off is required. | WS-01 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Inline badge `24ch` clamp and ellipsis CSS, plus style-contract test | Amp | Done | None | `npm run test -- tests/unit/ui/animationStyles.test.ts` |
| WS-02 | Copy/cut canonical serialization on `MentionInput`; paste rebuild tests | Amp | Done | None | `npm run test -- tests/jsdom/ui/RichChatInputToolBadge.test.ts` |
| WS-03 | Handbook + local AGENTS.md sync | Amp | Done | WS-01, WS-02 | `npm run check:specs` |

## Verification

- `npm run test -- tests/unit/ui/animationStyles.test.ts tests/jsdom/ui/RichChatInputToolBadge.test.ts tests/jsdom/ui/RichChatInputIme.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run check:specs`
- Human visual sign-off (coordinator must not check this): long `@` file/folder and `/` skill/tool badges in the composer input, a sent user message, and Settings → Commands Prompt editor; hover still shows the full `title`; light and dark themes.

## Documentation sync

- Numbered developer docs: `docs/04-input-panel-and-context.md`
- Nearest local guidance: `src/ui/shared/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`
- Parent/package guidance: `src/ui/chat/AGENTS.md` if the RichChatInput paste/copy map changes
- Root guidance and roadmap: None (no glossary or roadmap change)

## Progress and handoff

### 2026-09-07 — Amp — WS-01/WS-02/WS-03

- Changed: Spec made decision-complete and Active from the approved 24ch / plain-text-token plan.
- Evidence: User approved the plan in thread T-01a079d5-2a79-716b-b12b-4d9db7eadf8c.
- Remaining: Implement CSS, copy/cut, tests, docs.
- Blockers: None
- Next action: Implement WS-01 and WS-02 in this thread.

### 2026-09-07 — Amp — WS-01/WS-02/WS-03 implementation

- Changed: Inline badges clamp at `min(100%, 24ch)`; `MentionInput` copy/cut writes canonical tokens; paste still rebuilds recognized badges. Docs updated in `docs/04-input-panel-and-context.md`, `src/ui/shared/AGENTS.md`, `src/ui/chat/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`.
- Evidence: `npm run test -- tests/unit/ui/animationStyles.test.ts tests/jsdom/ui/RichChatInputToolBadge.test.ts tests/jsdom/ui/RichChatInputIme.test.ts` (15 passed); `npm run typecheck`; `npm run lint`; `npm run check:specs`.
- Remaining: Human visual sign-off in Obsidian.
- Blockers: None
- Next action: User inspects long badges in composer, sent user message, and Settings → Commands Prompt editor, light and dark.

### 2026-09-07 — Amp — baseline alignment fix

- Changed: Removed `overflow: hidden` from `.pivi-context-badge--inline` (it shifted the inline-block baseline). Clamp overflow now lives on `.pivi-context-badge-content`.
- Evidence: User screenshot of a raised `Tim Ferriss_ The Hidde...` badge; `npm run test -- tests/unit/ui/animationStyles.test.ts` green; plugin reloaded.
- Remaining: Human re-check that the badge sits on the same baseline as surrounding text.
- Blockers: None
- Next action: User re-inspects the same composer line.

### 2026-11-22 — Closeout review

- Implementation is on `main` in `a3a9d0aa`. The CSS contract, clipboard and IME suites passed in a six-suite focused run. The complete coverage suite and production build also passed.
- Human visual sign-off remains pending after the baseline fix. Inspect long badges in the composer, a sent message, and the Commands Prompt editor in light and dark themes, including baseline alignment and the full hover title.

### 2026-11-22 — Sandbox acceptance

- In Obsidian 1.15.1 with Pivi 0.32.2, long CJK file/folder badges and a long Skill badge rendered with ellipsis in the composer, a sent user message, and the Commands Prompt editor. The Prompt editor was inspected in light and dark. The composer copy/cut payload exactly matched the canonical file and folder input and rebuilt both badges on paste. Native cut/paste in Commands Prompt rebuilt the file, folder, Skill, and selected-text badges. File, folder and Skill titles were verified in the sent message DOM.
- Six focused suites across specs 051 and 053 passed, 57 tests total. Independent human visual sign-off remains pending.

### 2026-11-22 — Human visual sign-off

- The user explicitly approved the light- and dark-theme visual review of the composer, sent user messages, and Commands Prompt. The review included long file, folder and Skill badges, baseline alignment, and full hover text.
- The final focused cross-spec run passed 120 tests in 11 suites, including the style contract and mention clipboard and IME tests. Native Obsidian paste and the canonical token round trip were verified in Sandbox.

## Completion summary

The inline badge width cap, ellipsis and hover text are shipped. Composer and Commands Prompt copy/cut write canonical tokens and paste rebuilds recognized badges. History clipboard behavior remains outside this spec. Durable documentation is in the input-panel handbook and the UI and CSS guidance. Human visual sign-off completed on 2026-11-22.
