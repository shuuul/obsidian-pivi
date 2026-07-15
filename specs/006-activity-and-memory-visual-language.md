---
id: "006"
title: "Activity and Memory visual language foundations"
status: Active
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 006 — Activity and Memory visual language foundations

## Context

`docs/11-chat-ui-evolution.md` (Visual language + step 6) defines Narrative / Activity / Memory layers with a shared status vocabulary. Verified current state and gaps:

- Status vocabulary gap: docs require Queued / Running / Waiting / Completed / Failed / Cancelled / Orphaned. `ToolCallInfo.status` in `packages/pivi-agent-core/src/foundation/tools.ts` supports only `running | completed | error | blocked`; only subagents have `pending`/`orphaned` (`AsyncSubagentStatus`). No queued (hollow dot), waiting, or cancelled visuals exist anywhere (`ToolCallView.tsx`, `styles/components/toolcalls.css`).
- Status labels are not localized per state: `chat.stream.statusLabel` interpolates the raw status string (`Status: {status}`), violating the icon+text+color-together rule.
- The closest Activity-row primitive is the collapsed tool header (`.pivi-tool-header`: icon, name, summary, diff stats, status, chevron) and the imperative subagent header (`.pivi-subagent-header`). There is no elapsed-time column and no generic React Activity capsule.
- Memory layer is minimal: `ContextCompactedView` in `packages/pivi-react/src/chat/messages/AssistantContentView.tsx` renders a bare `pivi-compact-boundary` label ("Session compacted") with no token estimate (`~86K → ~9K`), no expansion, and truncation/paging boundaries have no chip at all.
- Docs step 6 says "prototype without changing persistence", but queued/cancelled/waiting state must survive reload to render honestly. Resolution below: additive optional fields only, with old files mapping to today's statuses.

## Goal and success criteria

Outcome: one status vocabulary shared by tools and Agent runs, a collapsed Activity row/capsule primitive, and a Memory divider/chip treatment, all i18n-complete and motion/a11y compliant, without breaking persisted sessions.

- [x] A shared UI status type covering queued, running, waiting, completed, failed, cancelled, orphaned exists in core foundation, with an explicit mapping table from today's `ToolCallInfo.status` and `AsyncSubagentStatus` values (old files map losslessly). Verified by mapping unit tests.
- [x] `StatusIcon` implements the docs table: queued = hollow dot no continuous animation; running = animated arc; waiting = pause symbol + explicit label; completed = check; failed = error mark + readable failure label; cancelled = stop mark; orphaned = disconnected mark + recovery explanation. Only running uses continuous Activity motion; `prefers-reduced-motion` disables it. Verified by jsdom tests + CSS review.
- [x] Every status word is a localized label (`chat.status.*`) rendered with the icon; `chat.stream.statusLabel` raw interpolation is removed. All 10 locale catalogs (`en`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh-CN`, `zh-TW`) are updated; placeholder-parity and dead-key gates pass.
- [x] An `ActivityRow` React component exists (icon, name, current activity summary, elapsed time) and tool plus imperative Agent headers adopt its structure/density. The transcript remains the only primary scroll container; expansion grows within the measured virtual row.
- [x] The Memory chip is a low-contrast divider with an approximation-marked token transition sourced from the compaction entry plus active-context estimator; older-history paging reuses the same family. No fake assistant message chrome.
- [x] `aria-live` announces status phase/terminal text changes, never token updates. Verified by React transition and Memory tests.
- [x] Monospace is reserved for identifiers, paths, commands, structured parameters, and numeric Memory transitions; Agent names and summaries use the host UI font.

## Scope and non-goals

In scope:

- Foundation status type + mapping (`packages/pivi-agent-core/src/foundation/tools.ts`, additive optional fields in `message_ui` only where reload honesty requires it).
- React components/styles: `ToolCallView.tsx`, new `ActivityRow`, `AssistantContentView.tsx` (`ContextCompactedView`), new/updated CSS modules registered in `packages/pivi-react/styles/manifest.mjs` (build fails on unlisted files; zero `!important`; `pivi-*` classes only).
- Imperative subagent renderers (`src/ui/chat/rendering/SubagentRenderer.ts`, `AsyncSubagentRenderer.ts`) adopting the same class vocabulary and status mapping.
- i18n keys in all locales; elapsed-time formatting helper.

Not in scope:

- Agent Group summary, expanded timeline, inspector, Active Work Shelf (spec 008).
- Context Inspector and checkpoint expansion content (spec 007; the Memory chip here only shows the transition and a disclosure affordance stub if 007 has not landed).
- New FIFO admission semantics. The current UI only knows an async Agent is pre-activity (`pending`), not whether the limiter actually queued it; the conservative legacy mapping displays that phase as queued and switches to running on the first child event. Cancellation is carried as an additive explicit activity fact from the existing abort/result boundary. A tool-level `waiting` state remains unused until a runtime reports it.
- One-off cards, status colors outside the shared set, nested scroll containers (explicit docs/11 prohibitions).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Persistence stays additive-optional: new status values persist only through optional `message_ui` fields; absent fields map to current behavior | Reconciles docs step 6 "without changing persistence" with honest reload rendering | WS-01 |
| 2026-07-15 | One `ActivityRow` primitive is shared by tools and subagents rather than two bespoke headers | docs/11: "collapsed primitive is an Activity row/capsule"; prevents visual drift | WS-03 |
| 2026-07-16 | Map legacy `pending` to the conservative pre-activity label queued, then switch to running on the first child event; do not present this as proof of FIFO admission | The limiter's true `queued` metadata is unavailable until after admission, while child output is direct evidence that execution started | WS-01, WS-02 |
| 2026-07-16 | Preserve legacy success/error fields and add optional `activityStatus` to tool/Agent UI records; only explicit runtime facts may set cancelled or waiting | Existing message_ui overlays already round-trip additive fields, so old sessions stay compatible and failure copy is never parsed to invent lifecycle state | WS-01, WS-02 |
| 2026-07-16 | Continuous motion is reserved for `running`; all other states are static, and reduced-motion keeps semantic color/icon feedback while stopping the running animation | Activity rows are high-frequency status UI; motion must communicate active work rather than decorate every transition | WS-02, WS-04, WS-06 |
| 2026-07-16 | React and imperative adapters share the core status/view-model facts and the `pivi-activity-*` CSS contract, but each keeps its existing DOM owner | Mounting React inside the stored-subagent adapter would violate the explicit imperative-island boundary | WS-02, WS-03 |
| 2026-07-16 | Remove the raw interpolated status key and localize canonical labels directly in all catalogs; orphaned also carries a localized recovery explanation | A visible icon alone or a raw protocol value is insufficient for accessible status communication | WS-02, WS-06 |
| 2026-07-16 | Keep the live elapsed ticker in React-owned rows; imperative subagent rows recompute only on lifecycle updates | Legacy imperative render helpers return bare DOM without an unload handle, so recurring timers there would be unowned; terminal timestamps still render the exact frozen duration | WS-03, WS-04 |
| 2026-07-16 | Carry before/after active-context estimates on new compaction chunks and recompute the post-compaction estimate at the exact JSONL entry on reopen | The checkpoint summary size is not the active context size; legacy UI blocks without both facts must remain label-only | WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Shared status vocabulary + mapping from existing tool/subagent statuses; additive persistence fields with sanitizer coverage | Codex | Done | None | Mapping unit tests; session compat suites green |
| WS-02 | `StatusIcon` per docs table + localized `chat.status.*` labels in all 10 locales; remove raw `statusLabel` interpolation | Codex | Done | WS-01 | `tests/pivi-react/ToolCallView.test.tsx` extended; `node scripts/check-i18n-dead-keys.mjs`; placeholder-parity test |
| WS-03 | `ActivityRow` component (icon/name/summary/elapsed) adopted by tool header and imperative subagent header | Codex | Done | WS-01 | Focused React/imperative suites green; final Obsidian pass remains in spec verification |
| WS-04 | Elapsed-time ticker that only animates while running and respects `prefers-reduced-motion` and owner-window timers | Codex | Done | WS-03 | Owner-window registration/cleanup and terminal freeze test; open-handle audit clean |
| WS-05 | Memory chip: token-transition compaction divider with approximation marker; shared chip family reserved for paging/recovery boundaries | Codex | Done | WS-01 | Runtime/mapper/projection/virtual-list tests green; final manual compaction check remains |
| WS-06 | Accessibility pass: `aria-live` phase/terminal announcements, no token-level announcements; monospace audit | Codex | Done | WS-02, WS-03 | jsdom transition assertions + CSS/motion/font audit |

Guidance for low-context agents:

1. Read `packages/pivi-react/styles/AGENTS.md` before adding CSS: new files must be listed in `manifest.mjs`, use `pivi-*`/`--pivi-*` naming, `.is-*`/`.status-*` state modifiers, no `!important`, no `:has`.
2. i18n workflow: add to `packages/pivi-react/src/i18n/locales/en.json` first, mirror the exact key tree with real translations in the other nine catalogs in the same commit (root AGENTS.md Coding Standard 10).
3. Imperative renderers get translated strings via `@/app/i18n`; never import app translator state into packages.
4. Sentence case for all new UI copy (ESLint `obsidianmd/ui/sentence-case` must stay at 0 warnings).
5. Do not add competing context indicators or new card borders; density and structure differentiate layers (docs/11 opening constraint).

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- Manual in Obsidian (deploy flow from root AGENTS.md): run tools, a blocking subagent, a background subagent, cancel one, trigger compaction; check main window, pop-out, dark/light themes, reduced-motion OS setting.
- `obsidian dev:errors` returns `No errors captured.`

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Visual language and Status semantics sections marked implemented where true).
- Nearest local guidance: `packages/pivi-react/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`, `packages/pivi-react/src/i18n/AGENTS.md`.
- Parent/package guidance: `src/ui/chat/rendering/AGENTS.md` (renderer status mapping).
- Root guidance and roadmap: `AGENTS.md` glossary if Activity row / Memory chip become canonical terms.

## Progress and handoff

### 2026-07-16 — Activation and fact audit — Codex

- Changed: activated the spec, claimed every workstream, and recorded the motion policy before implementation.
- Evidence: `ToolCallInfo.status` remains `running | completed | error | blocked`; `AsyncSubagentStatus` remains `pending | running | completed | error | orphaned`. The engine's FIFO lease reports `queued`/`queuePosition` only after admission, and cancelled currently appears as a structured Agent-report outcome rather than a persisted UI lifecycle state.
- Problem recorded: the original non-goal overstated existing runtime support for queued/cancelled. WS-01 must either expose a truthful additive source or map only states that current durable data can prove; it must not infer cancellation from arbitrary failure copy.
- Verification: `npm run check:specs` before activation commit.
- Remaining: WS-01 through WS-06.
- Next action: complete the status/persistence audit and land the shared mapping contract with focused compatibility tests.

### 2026-07-16 — WS-01 shared activity status — Codex

- Changed: added the seven-state `ActivityStatus` vocabulary and pure legacy mapping helpers; added optional persisted `activityStatus` facts to tool and Agent UI records. The first child text/tool event now moves a pre-activity async Agent to running. Background abort emits an explicit cancelled activity chunk, and `spawn_agent` terminal details preserve the same fact while retaining legacy `status: error`.
- Evidence: the status audit proved limiter `queued` metadata is terminal-only, `pending` can overlap real execution, cancellation was previously flattened to error, waiting has no source, and orphaned already round-trips. The implementation therefore does not infer cancelled/waiting and does not describe pre-activity as proven FIFO admission.
- Verification: `npm run test -- --runInBand tests/unit/pivi-agent-core/activityStatus.test.ts tests/unit/features/chat/subagentManager.test.ts tests/unit/pi/runtime/piBackgroundSubagentJobs.test.ts tests/unit/pi/tools/createSubagentTool.test.ts tests/unit/pi/messageMapper.test.ts tests/unit/app/session/openSessionManager.test.ts` (6 suites / 65 tests); `npm run typecheck`; `npm run lint`.
- Remaining: WS-02 through WS-06.
- Next action: implement the localized `StatusIcon`/Activity row presentation over the canonical mapping.

### 2026-07-16 — WS-02 localized status semantics — Codex

- Changed: tool rows and step groups now render all seven canonical statuses with icon, localized visible text, semantic color, and polite atomic live regions. Only running renders the arc/spinner. Imperative tool/subagent headers consume the same canonical mapping and class vocabulary. Removed `chat.stream.statusLabel` raw protocol interpolation, localized all status and imperative Agent chrome across ten catalogs, and added an orphan recovery explanation.
- Evidence: UI audit found the old individual tool row intentionally hid its running icon, imperative subagent chrome hard-coded English, touch hover/motion and monospace cleanup still pending, and React cannot own imperative subagent DOM. The implementation keeps ownership intact while sharing facts and CSS classes.
- Verification: `npm run test -- --runInBand tests/pivi-react/ToolCallView.test.tsx tests/pivi-react/i18n.test.tsx tests/unit/features/chat/subagentActivity.test.ts tests/unit/ui/toolCallCss.test.ts` (3 suites / 51 tests); `npm run typecheck`; `npm run lint`; `npm run check:i18n-dead-keys`.
- Remaining: WS-03 through WS-06.
- Next action: extract the Activity row layout, add truthful elapsed timing, and remove redundant running animations.

### 2026-07-16 — WS-03/04 shared Activity row and elapsed time — Codex

- Changed: extracted the React `ActivityRow`/status badge, adopted it in tool rows and step groups, and aligned imperative Agent headers to the same `pivi-activity-*` layout contract. Added additive start/completion timestamps at tool event boundaries, live elapsed time for running React rows, frozen terminal durations, and UI-font treatment for human names/summaries. Removed the decorative running-header gradient and gated hover affordances to fine pointers.
- Problem recorded: the first imperative elapsed implementation created recurring timers from legacy render helpers that return only a DOM element. `--detectOpenHandles` found 13 leaked intervals. The corrected imperative path updates elapsed text only when a lifecycle event arrives; the React path owns the only live interval and clears it on status change/unmount.
- Evidence: the React timer test mounts into an iframe document, proves registration/cleanup against that row's `ownerWindow`, advances the running value, and proves the completed timestamp remains frozen. Subagent scrolling now also schedules through its content element's owner window.
- Verification: `npm run test -- --runInBand tests/pivi-react/ToolCallView.test.tsx tests/pivi-react/chatStreamReducer.test.ts tests/unit/features/chat/subagentActivity.test.ts tests/unit/ui/toolCallCss.test.ts` (3 suites / 53 tests); `npm run test -- --runInBand --detectOpenHandles tests/unit/features/chat/subagentActivity.test.ts` (27 tests, no open handles); `npm run typecheck`; `npm run lint`; `npm run test -- --runInBand tests/unit/architecture` (2 suites / 90 tests); `npm run build:css`.
- Remaining: WS-05 and WS-06 plus final manual verification.
- Next action: implement the Memory chip with honest compaction estimates and the shared paging-boundary family.

### 2026-07-16 — WS-05 Memory boundaries — Codex

- Changed: compaction now emits additive `tokensBefore` / `tokensAfter` active-context estimates into the stream and Memory content block. Reopened JSONL sessions estimate the active context at the exact compaction entry. The React boundary renders a low-contrast approximation-marked transition only when both values exist; legacy blocks stay label-only. Durable older-history availability now reaches the React snapshot and inserts a virtualized boundary row from the same Memory chip family.
- Problem recorded: the existing checkpoint schema contains a checkpoint-summary token estimate, but that is not the post-compaction active context. The implementation deliberately calls the full active-context estimator after append and at the stored entry boundary instead of displaying the checkpoint estimate.
- Evidence: runtime tests assert both compaction estimates and reduction; mapper tests assert the persisted `tokensBefore` plus recomputed `tokensAfter`; React tests assert `~86K → ~9K`, no token live region, no invented legacy transition, and the older-history separator row.
- Verification: focused runtime/mapper/projection/React/virtual-list suites (7 suites / 109 tests); `npm run typecheck`; `npm run lint`; i18n/boundary/CSS gates pending immediately before commit.
- Remaining: WS-06 plus final manual/full verification.
- Next action: finish the accessibility/motion/font audit, then run the spec-wide gates and Obsidian check.

### 2026-07-16 — WS-06 accessibility and motion audit — Codex

- Changed: retained a polite atomic live region for localized phase/terminal status text while keeping elapsed time and Memory token transitions outside announcements. Removed looping Agent profile glyph animations and the redundant full-status-icon spin; the trailing running arc is now the sole continuous motion inside Activity rows, with the existing reduced-motion override. Updated the canonical docs and package/local guides for Activity rows and Memory boundaries.
- Evidence: the status transition test rerenders queued → running → completed through one live region. Memory tests assert no `aria-live`. CSS tests reject the former running-header/profile keyframes and require reduced-motion to disable the remaining arc. Tool/Agent human labels and summaries use the interface font; monospace remains on identifiers, paths, commands, structured results, and numeric transitions.
- Verification: focused Activity/Memory/UI style suites, full typecheck, lint, architecture, i18n, and CSS gates are green before this commit; final full coverage/build/manual verification remains.
- Remaining: spec-wide verification, Obsidian reload/error check, completion summary, and archive.
- Next action: commit WS-06, then execute the full verification matrix.

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: status union gap confirmed in `foundation/tools.ts`; raw `statusLabel` interpolation confirmed in locale catalogs; bare compaction label confirmed in `AssistantContentView.tsx`.
- Remaining: all workstreams.
- Blockers: none hard; benefits from spec 003 (entity subscriptions) landing first so `ActivityRow` subscribes narrowly from day one.
- Next action: claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
