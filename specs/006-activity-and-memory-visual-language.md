---
id: "006"
title: "Activity and Memory visual language foundations"
status: Draft
created: 2026-07-15
updated: 2026-07-15
coordinator: "Unassigned"
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

- [ ] A shared UI status type covering queued, running, waiting, completed, failed, cancelled, orphaned exists in core foundation, with an explicit mapping table from today's `ToolCallInfo.status` and `AsyncSubagentStatus` values (old files map losslessly). Verified by mapping unit tests.
- [ ] `StatusIcon` (in `packages/pivi-react/src/chat/messages/ToolCallView.tsx`) implements the docs table: queued = hollow dot no continuous animation; running = animated arc; waiting = pause symbol + explicit label; completed = check; failed = error mark + readable failure label; cancelled = stop mark; orphaned = disconnected mark + recovery explanation. Only running uses continuous motion; `prefers-reduced-motion` disables it. Verified by jsdom tests + CSS review.
- [ ] Every status word is a localized label (new `chat.status.*` keys) rendered with the icon; `chat.stream.statusLabel` raw interpolation is removed. All 10 locale catalogs (`en`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh-CN`, `zh-TW`) updated in the same commit; placeholder-parity and dead-key gates pass.
- [ ] An `ActivityRow` React component exists (icon, name, current activity summary, elapsed time) and the tool header plus subagent header adopt its structure/density without visual regression to Narrative weight. The transcript remains the only primary scroll container; expansion grows within the measured virtual row.
- [ ] The Memory chip: `ContextCompactedView` becomes a low-contrast divider/chip with an approximation-marked token transition (`~before → ~after`) sourced from `tokensBefore` on the compaction entry plus the estimator; older-history paging (from spec 002) reuses the same chip family. No fake assistant message chrome.
- [ ] `aria-live` announces phase changes and terminal state only, never token updates. Verified by test asserting announcement points.
- [ ] Monospace is used only for tool identifiers, IDs, paths, commands, structured parameters; Agent names and summaries use the host UI font (CSS audit against `toolcalls.css`, `subagent.css`).

## Scope and non-goals

In scope:

- Foundation status type + mapping (`packages/pivi-agent-core/src/foundation/tools.ts`, additive optional fields in `message_ui` only where reload honesty requires it).
- React components/styles: `ToolCallView.tsx`, new `ActivityRow`, `AssistantContentView.tsx` (`ContextCompactedView`), new/updated CSS modules registered in `packages/pivi-react/styles/manifest.mjs` (build fails on unlisted files; zero `!important`; `pivi-*` classes only).
- Imperative subagent renderers (`src/ui/chat/rendering/SubagentRenderer.ts`, `AsyncSubagentRenderer.ts`) adopting the same class vocabulary and status mapping.
- i18n keys in all locales; elapsed-time formatting helper.

Not in scope:

- Agent Group summary, expanded timeline, inspector, Active Work Shelf (spec 008).
- Context Inspector and checkpoint expansion content (spec 007; the Memory chip here only shows the transition and a disclosure affordance stub if 007 has not landed).
- New runtime cancellation/queueing semantics; this spec renders states the runtime already knows (queued/cancelled exist for subagents and turn queueing; a tool-level `waiting` state is rendered only if the runtime reports it, otherwise the mapping leaves it unused).
- One-off cards, status colors outside the shared set, nested scroll containers (explicit docs/11 prohibitions).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Persistence stays additive-optional: new status values persist only through optional `message_ui` fields; absent fields map to current behavior | Reconciles docs step 6 "without changing persistence" with honest reload rendering | WS-01 |
| 2026-07-15 | One `ActivityRow` primitive is shared by tools and subagents rather than two bespoke headers | docs/11: "collapsed primitive is an Activity row/capsule"; prevents visual drift | WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Shared status vocabulary + mapping from existing tool/subagent statuses; additive persistence fields with sanitizer coverage | Unassigned | Pending | None | Mapping unit tests; session compat suites green |
| WS-02 | `StatusIcon` per docs table + localized `chat.status.*` labels in all 10 locales; remove raw `statusLabel` interpolation | Unassigned | Pending | WS-01 | `tests/pivi-react/ToolCallView.test.tsx` extended; `node scripts/check-i18n-dead-keys.mjs`; placeholder-parity test |
| WS-03 | `ActivityRow` component (icon/name/summary/elapsed) adopted by tool header and imperative subagent header | Unassigned | Pending | WS-01 | jsdom tests + visual check in Obsidian (main + pop-out) |
| WS-04 | Elapsed-time ticker that only animates while running and respects `prefers-reduced-motion` and owner-window timers | Unassigned | Pending | WS-03 | Unit test with fake timers; reduced-motion assertion |
| WS-05 | Memory chip: token-transition compaction divider with approximation marker; shared chip family reserved for paging/recovery boundaries | Unassigned | Pending | WS-01 | `AssistantContentView` tests extended; manual compaction check |
| WS-06 | Accessibility pass: `aria-live` phase/terminal announcements, no token-level announcements; monospace audit | Unassigned | Pending | WS-02, WS-03 | jsdom assertions + CSS review notes in Progress |

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

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: status union gap confirmed in `foundation/tools.ts`; raw `statusLabel` interpolation confirmed in locale catalogs; bare compaction label confirmed in `AssistantContentView.tsx`.
- Remaining: all workstreams.
- Blockers: none hard; benefits from spec 003 (entity subscriptions) landing first so `ActivityRow` subscribes narrowly from day one.
- Next action: claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
