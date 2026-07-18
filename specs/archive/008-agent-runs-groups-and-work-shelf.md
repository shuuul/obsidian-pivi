---
id: "008"
title: "First-class Agent runs, Agent Groups, timeline, and Active Work Shelf"
status: Completed
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 008 — First-class Agent runs, Agent Groups, timeline, and Active Work Shelf

## Context

`docs/11-chat-ui-evolution.md` (Agent execution model + step 8) promotes delegated work to first-class Agent runs with grouped presentation. Verified current state:

- Subagent state is nested inside a tool call: `ToolCallInfo.subagent: SubagentInfo` (`packages/pivi-agent-core/src/foundation`), rendered by short-circuiting `ToolCallView` to `ImperativeSubagentSlot`, which mounts the imperative `SubagentRenderer`/`AsyncSubagentRenderer` from `src/ui/chat/rendering/`. There is no independent `AgentRun` projection; `ChatAgentRunEntity` in `packages/pivi-react/src/store/chatProjectionStore.ts` is derived from `toolCalls[].subagent`.
- Runtime correlation lives in `src/ui/chat/services/SubagentManager.ts` and `src/ui/chat/stream/streamSubagentLifecycle.ts` (`StreamSubagentCoordinator`: retry/hydrate timers, orphan handling); `ChatState` keeps reverse indexes (`ownerMessageBySubagentId/ByAgentId/ByToolId`).
- The durable trace persists in `PIVI_MESSAGE_UI` entries plus the subagent's own JSONL (`subagentJsonl.ts`); background jobs run through `piBackgroundSubagentJobs.ts` with FIFO admission (`subagentConcurrencyLimiter.ts`) and a plugin-wide concurrency limit.
- There is no Agent Group summary ("3 agents 2 complete 1 running"), no expanded linear timeline, no inspector, and no Active Work Shelf near the composer. Structured parent reports arrive from spec 005.
- Docs constraints: the transcript stays the only primary scroll container; expanded Activity grows within its measured virtual row or opens in an inspector; the shelf mirrors running state only, with the canonical trace attached to its transcript owner.

## Goal and success criteria

Outcome: Agent runs are a first-class projection with stable identity and relationships, grouped and inspectable presentation, and an optional composer-adjacent shelf, while the durable JSONL trace and all existing lifecycle guarantees are preserved.

- [x] An `AgentRun` projection entity exists with stable ownership (`runId`, `parentRunId`, owning message/tool references), status (using the spec 006 shared vocabulary), current activity, tool references, timing, usage, and terminal result reference. It is derived from existing durable data; JSONL remains the source of truth. Verified by projection unit tests including nested (parent/child) runs.
- [x] The durable session keeps the complete visible trace (objective/prompt, tool activity, recovery-relevant partial output, terminal output, timing/usage, cancellation/failure/orphan state); no field currently persisted is dropped. Verified by session-compat fixtures.
- [x] Related Agent runs in one message render as an Agent Group with a summary line (counts by status) that expands to individual Activity rows (spec 006 primitive). Verified by jsdom tests.
- [x] Expanding one run shows a linear timeline (indentation + connectors) of its steps inside the measured virtual row, or in an inspector surface; no independently scrolling card inside the transcript. Verified by test asserting no nested scroll container and manual check.
- [x] An optional Active Work Shelf near the composer mirrors running/background runs; selecting an item navigates to the transcript owner or opens the same inspector; shelf state never becomes canonical. Toggle default and persistence decided by Decision. Verified by jsdom tests + manual background-run walkthrough.
- [x] When a validated structured report (spec 005) exists, the run's terminal presentation promotes the conclusion into Narrative per docs/11 (terminal Subagent conclusions promoted into the answer); otherwise today's text rendering stands.
- [x] Every existing lifecycle regression suite stays green: queued/running abort, dynamic capacity, late events, orphaning, hydrate retry cancellation/rejection, session switching, pop-out owner realms, virtual scroll anchoring.

## Scope and non-goals

In scope:

- Projection derivation (`chatProjectionStore.ts` + producers in `src/ui/chat/`), reusing spec 004's run-scoped event metadata (`runId`/`parentRunId`).
- React presentation: Agent Group summary, Activity-row list, timeline expansion, inspector surface, shelf component in composer chrome; CSS via manifest; i18n in all 10 catalogs.
- Migrating subagent presentation from the imperative renderers toward the React `AgentActivity` subscription target where feasible; imperative adapters remain for Markdown-rich bodies per the React ownership rules.
- Interaction testing before enabling the shelf by default (docs/11 orders step 8 "after interaction testing").

Not in scope:

- Changing subagent runtime semantics (admission, FIFO, limits) or the spawn tool contract.
- Persisting a new run log; derivation only.
- Cross-process or remote runtimes.
- Any framework migration (Virtuoso, assistant-ui, etc., explicit docs non-goals).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | `AgentRun` is a derived read model over existing `message_ui` + subagent JSONL; no new durable format | docs/11: UI trace persistence and parent-model context are separate concerns; JSONL stays authoritative | WS-01 |
| 2026-07-15 | Shelf ships behind a default-off toggle until interaction testing passes | docs/11 sequences the shelf last, "after interaction testing" | WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `AgentRun` projection entity + derivation from tool-call subagent state, parent/child links, timing/usage | Codex | Done | Spec 004 WS-02 (run metadata), spec 006 WS-01 (status vocabulary) | Projection unit tests incl. nested runs and reload hydration |
| WS-02 | Agent Group summary + expansion to Activity rows | Codex | Done | WS-01, spec 006 WS-03 | jsdom tests over direct and projected Agent runs |
| WS-03 | Run timeline expansion within measured virtual row + inspector surface; no nested scroll | Codex | Done | WS-02 | jsdom test asserting ordered depths, disclosure semantics, and no nested scroll |
| WS-04 | Structured-report terminal presentation (Narrative promotion) with text fallback | Codex | Done | WS-01, spec 005 WS-04 | Projection and renderer tests over direct, fenced, invalid, and text fixtures |
| WS-05 | Active Work Shelf (default off) with owner navigation and attention state | Codex | Done | WS-01 | projection/settings/jsdom/app-adapter tests incl. inactive-tab owner navigation |
| WS-06 | Lifecycle regression sweep + before/after traces (20-agent scenario) with spec 001 harness | Codex | Done | WS-01..WS-05 | Full coverage + three corrected real-Obsidian traces |

Guidance for low-context agents:

1. Read `src/ui/chat/AGENTS.md`, `src/ui/chat/rendering/AGENTS.md`, and `packages/pivi-react/AGENTS.md` first; subagent hydrate/orphan timers are subtle, do not refactor `streamSubagentLifecycle.ts` casually.
2. All timers/animation must use the owner window realm; background completion must set attention state even when the tab is inactive (existing behavior to preserve).
3. Shelf and inspector are chrome surfaces, not transcript rows; the canonical trace stays attached to the owning message.
4. Reuse spec 006's `ActivityRow` and status vocabulary; do not invent parallel status styling.
5. i18n/styles rules identical to specs 006/007 (10-locale mirror, manifest-registered CSS, sentence case, zero `!important`).

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- Regression suites named in success criteria; session-compat fixtures for persisted subagent traces.
- Manual: blocking run, background run to completion while switched away, cancellation of queued and running runs, orphan recovery after reload, nested delegated work, pop-out window; `obsidian dev:errors` clean.
- Performance: 20-agent scenario traces before/after (spec 001).

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (First-class Agent runs, Activity layer, Active Work Shelf sections) plus the subagent numbered doc.
- Nearest local guidance: `src/ui/chat/AGENTS.md`, `src/ui/chat/rendering/AGENTS.md`, `packages/pivi-react/AGENTS.md`.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` if run-model types land in core.
- Root guidance and roadmap: `AGENTS.md` glossary (AgentRun, Agent Group, Active Work Shelf) and architecture status.

## Progress and handoff

### 2026-07-16 — Activation — Codex

- Changed: activated spec 008 after specs 004–007 completed; assigned every workstream to the coordinator as requested.
- Evidence: prerequisite run metadata, structured reports, shared Activity vocabulary, projection subscriptions, and owner-realm Memory/Inspector primitives are present and verified in their archived specs.
- Remaining: WS-01 through WS-06.
- Next action: audit the existing derived `ChatAgentRunEntity`, durable subagent fields, nested-run correlation, and React Activity primitive before defining the smallest forward-only `AgentRun` read model.

### 2026-07-16 — WS-01 first-class AgentRun projection — Codex

- Problem recorded: the previous `ChatAgentRunEntity` only wrapped `SubagentInfo`, chose `agentId ?? subagent.id` as its key, and indexed only top-level runs. A background run therefore changed identity when its runtime ID arrived, while nested delegated runs had no entity.
- Changed: added the foundation-owned `AgentRun` read model and recursively derive it from durable nested tool/subagent state. The persisted spawn-tool ID is the stable `runId`; runtime `agentId` is metadata. Each entity carries owner message/tool, parent/children, canonical Activity status, current direct activity, direct tool IDs, timing, optional usage, and terminal result reference. Projected imperative slots now subscribe by stable run ID.
- Evidence: 61 focused projection/ToolCall/assistant tests passed. New fixtures cover nested parent/child derivation, restored `replaceAll` hydration, current activity, usage and terminal references, and stable identity when runtime `agentId` arrives. Typecheck and zero-warning lint pass.
- Remaining: WS-02 through WS-06. Durable trace compatibility remains a final acceptance check; no persisted field was removed or rewritten in WS-01.
- Next action: group sibling top-level Agent runs per owning message and render the shared Activity rows from the new entities.

### 2026-07-16 — WS-02 Agent Group — Codex

- Problem recorded: consecutive delegated runs rendered as independent imperative islands, so the transcript had no at-a-glance count or aggregate lifecycle signal and repeated activity chrome for sibling work.
- Changed: consecutive top-level Agent runs owned by one assistant message now collapse into a localized Agent Group summary. The summary aggregates the shared seven-state Activity vocabulary and expands in place to one shared `ActivityRow` per stable run ID. Both direct message rendering and granular projection subscriptions use the same presentation; single runs retain the existing rich adapter path.
- Evidence: focused jsdom coverage verifies a three-run `2 Completed · 1 Running` summary, disclosure semantics, stable row ordering, direct current-activity display, no nested scroll container, and a live projected transition to `3 Completed`. Typecheck passes.
- Remaining: WS-03 through WS-06. Manual multi-agent interaction is retained for the final synthetic harness sweep so it can validate grouping, timeline, shelf, and lifecycle behavior together.
- Next action: make each expanded Agent row disclose its linear tool/delegation timeline inside the measured transcript row.

### 2026-07-16 — WS-03 Agent timeline inspector — Codex

- Changed: each Agent row in an expanded group is now its own accessible disclosure. Its in-row inspector presents the delegated objective and prompt, then a linear ordered tool/delegation timeline with depth markers and connectors, followed by preserved terminal text when present. Nested delegated tools are flattened in durable execution order while retaining their depth.
- Constraints preserved: the inspector grows inside the owning measured virtual row, uses no independent scrolling or timers, and reuses `ActivityRow` plus the canonical seven-state mapping for every tool and child-Agent step.
- Evidence: focused jsdom coverage verifies disclosure/region labels, objective/prompt/result preservation, exact `0, 0, 1` nested step depths, and absence of a nested scroll style. The 16-test assistant renderer suite, typecheck, and zero-warning lint pass.
- Remaining: WS-04 through WS-06, plus final synthetic manual interaction/performance validation.
- Next action: normalize validated structured Agent reports into the projection and promote their conclusion into the Narrative layer while retaining plain-text fallback.

### 2026-07-16 — WS-04 structured Narrative conclusion — Codex

- Changed: `ChatAgentRunEntity` now carries an already validated report projection. Derivation prefers the persisted `toolUseResult.agent_report` and can recover the last valid fenced report from complete terminal text; both paths reuse the strict spec 005 parser, including safe artifact-path validation.
- Presentation: terminal validated reports render as quiet document-like Agent conclusions after the Activity group, with summary/objective, outcome, findings, decisions, artifacts, and open questions. The raw structured block is not duplicated inside the timeline. Absent or invalid reports continue to show the complete plain terminal result in the in-row inspector.
- Problem recorded and fixed during review: an unconditional empty conclusions container would have added vertical whitespace to every report-less group; it is now mounted only when at least one terminal validated report exists.
- Evidence: 44 focused projection/renderer tests pass. They cover persisted structured details, fenced-text recovery, invalid-report rejection, Narrative fields, safe vault-relative artifact display, and plain-text fallback. Typecheck and zero-warning lint pass.
- Remaining: WS-05, WS-06, durable session-compat acceptance, and final synthetic manual/performance verification.
- Next action: add the default-off persisted Active Work Shelf using projection state only, with navigation back to the owning transcript message.

### 2026-07-16 — WS-05 Active Work Shelf — Codex

- Decision implemented: `subagents.showActiveWorkShelf` is synchronized vault configuration and defaults to `false`. Settings exposes the localized toggle in all ten catalogs; open views refresh their composer snapshots after the setting is saved.
- Changed: every tab projection publishes a stable, non-canonical list of active top-level background runs (`queued`, `running`, or `waiting`). `ActiveChatUiBridge` derives one shelf snapshot across all tabs in its mounted view, so switching away from a background task does not hide it. Completed/cancelled/failed/orphaned runs leave the shelf while the existing inactive-tab attention flag remains authoritative for completion attention.
- Navigation: selecting a shelf row switches to its owner tab when necessary, then centers the owning transcript message through `MessageViewportHandle`. If the new virtual viewport has not mounted yet, the adapter holds one transient pending navigation and fulfills it as soon as that viewport handle publishes; no DOM query, timer, or persisted shelf state is used.
- Problem recorded and corrected: the first local implementation subscribed only to the active projection. That passed a same-tab test but contradicted the spec's tab-switch walkthrough and persistent-visibility intent, so it was replaced before commit with the cross-tab derived bridge. A requested lightweight seam-review agent was unavailable due model capacity; local source inspection and focused tests supplied the evidence instead.
- Evidence: 91 focused settings/projection/React tests plus 70 focused bridge/app-adapter tests pass. Coverage includes default-off migration, toggle persistence, active-only filtering, stable snapshot identity, inactive-tab shelf visibility, completion removal, no nested shelf scroll, tab switching, deferred viewport navigation, typecheck, lint, CSS, i18n, and architecture checks.
- Remaining: WS-06 lifecycle/session compatibility sweep, synthetic 20-Agent performance traces, full coverage/build/reload, and spec archival.
- Next action: run the named lifecycle suites and session-compat fixtures, then the isolated spec 001 20-Agent harness without touching user tabs.

### 2026-07-16 — WS-06 compatibility and isolated trace harness — Codex

- Added one explicit session-compat fixture that restores the complete persisted Agent overlay: objective/prompt, parent and nested tool activity, recovery-relevant partial and terminal output, timing, usage, and cancelled/failed/orphaned lifecycle facts.
- Extended the spec 001 development harness with a 20-Agent workload that copies the fixed fixture to a unique temporary session, opens it in a disposable persistence-suspended tab, verifies all 20 runs, restores the original tab, and removes the temporary tab/JSONL/index. The command owns trace start/export so no user tab or durable binding is reused.
- Evidence so far: the consolidated lifecycle, compatibility, projection, owner-realm, virtual-scroll, fixture, command, and cleanup matrix passes in 20 suites / 222 tests. Source/test typecheck, zero-warning lint, architecture, package-readme, i18n, and spec checks pass. The 20-Agent after trace and full coverage/build gates remain pending.
- Problem recorded: the first isolated after trace (`2026-07-16T04-30-51-653Z-agent-runs-20-main-isolated.json`) stopped after restoring the original tab. Its 25-row / 34-Markdown maxima included cleanup rendering and exceeded the scenario's ≤5-row / ≤6-render budget even though the 534-node maximum stayed inside the DOM ceiling. The harness now exposes a pre-cleanup hook so the command stops and exports while the isolated fixture is still active; cleanup remains unconditional in `finally`.
- Accepted evidence: three corrected traces (`04-36-47-327Z`, `04-38-00-858Z`, `04-38-38-523Z`) each recorded 1 projection commit, 2 mounted rows, 73 DOM nodes, 2 Markdown renders, and 1 long task. Median Markdown duration was 1.6 ms and median longest task was 467 ms. Every run stayed inside the 20-Agent budget; tab-state SHA-256 was unchanged, no temporary session remained, the production bundle was restored without the development marker, and `obsidian dev:errors` was clean.
- Remaining: full coverage, final bundle-size/build gates, documentation audit, and archival.
- Next action: run the complete repository verification matrix and record the final evidence.

### 2026-07-16 — WS-06 final verification — Codex

- Full verification passed: `npm run test:coverage -- --runInBand` completed 239 suites / 1,847 tests with 68.93% statements, 58.31% branches, 66.02% functions, and 70.39% lines. `npm run typecheck`, zero-warning `npm run lint`, and `npm run check:boundaries` also passed.
- Production evidence: `npm run build` deployed the production artifacts; `npm run check:bundle-size` measured `main.js` at 3,071,792 bytes (2.93 MB), leaving 2,171,088 bytes (2.07 MB) below Obsidian's 5 MB cap. `obsidian plugin:reload id=pivi` and `obsidian dev:errors` passed with no captured errors.
- Interaction substitution: the user approved isolated synthetic tabs instead of reusing the original tabs. Deterministic lifecycle, projection, cross-tab shelf, deferred navigation, session compatibility, owner-realm, and virtual-scroll tests cover the manual matrix; the real Obsidian 20-Agent workload used a disposable tab/session and restored the original tab state byte-for-byte.
- Documentation audit: durable conclusions are synchronized into `docs/06-subagents-streaming-and-rendering.md`, `docs/08-presentation-and-settings.md`, `docs/11-chat-ui-evolution.md`, root `AGENTS.md`, and the owning core/React/app/chat/rendering guidance. No remaining code or documentation criterion is open.
- Next action: mark the spec completed, move it to `specs/archive/`, and update the index.

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: tool-call-nested subagent model confirmed in `foundation` types, `ToolCallView.tsx`, `SubagentManager.ts`, `streamSubagentLifecycle.ts`.
- Remaining: all workstreams.
- Blockers: depends on spec 004 (run metadata), spec 005 (report schema), spec 006 (status vocabulary, ActivityRow); start only after those land.
- Next action: none until dependencies complete; then claim WS-01.

## Completion summary

Delivered a stable derived `AgentRun` read model over the existing durable session trace; React-owned Agent Groups with canonical Activity summaries; accessible in-row timelines with nested depth, objective/prompt, tools, and terminal text; validated Narrative conclusions with plain-text fallback; and a synchronized, default-off Active Work Shelf derived across tabs with semantic owner navigation. JSONL remains authoritative and no second run registry or persisted shelf was introduced.

The implementation intentionally keeps single rich Agent runs on the imperative adapter while grouping consecutive sibling runs in React. The shelf stayed default off after interaction testing and uses a mounted-view cross-tab derivation rather than only the active projection. The requested live walkthrough was replaced, with user approval, by isolated deterministic tabs and a disposable real-Obsidian 20-Agent fixture so no original tab or durable binding was manipulated. A first performance trace incorrectly included original-tab cleanup; the issue and discarded trace are recorded, the harness now stops through a pre-cleanup hook, and three corrected traces satisfy every budget with unchanged tab-state bytes and no residual temporary session.

Final verification on 2026-07-16 passed: 239 Jest suites / 1,847 tests; 68.93% statements, 58.31% branches, 66.02% functions, 70.39% lines; source/test typecheck; zero-warning lint; architecture/package-readme/i18n/spec checks; production CSS/bundle build; 3,071,792-byte `main.js` with 2,171,088 bytes of limit headroom; production plugin reload; and clean Obsidian error capture. Durable behavior, boundaries, settings, terminology, performance protocol/results, and maintenance rules are synchronized into the numbered handbook and layered `AGENTS.md` files listed above.
