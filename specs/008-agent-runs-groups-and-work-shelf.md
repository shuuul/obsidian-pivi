---
id: "008"
title: "First-class Agent runs, Agent Groups, timeline, and Active Work Shelf"
status: Active
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

- [ ] An `AgentRun` projection entity exists with stable ownership (`runId`, `parentRunId`, owning message/tool references), status (using the spec 006 shared vocabulary), current activity, tool references, timing, usage, and terminal result reference. It is derived from existing durable data; JSONL remains the source of truth. Verified by projection unit tests including nested (parent/child) runs.
- [ ] The durable session keeps the complete visible trace (objective/prompt, tool activity, recovery-relevant partial output, terminal output, timing/usage, cancellation/failure/orphan state); no field currently persisted is dropped. Verified by session-compat fixtures.
- [ ] Related Agent runs in one message render as an Agent Group with a summary line (counts by status) that expands to individual Activity rows (spec 006 primitive). Verified by jsdom tests.
- [ ] Expanding one run shows a linear timeline (indentation + connectors) of its steps inside the measured virtual row, or in an inspector surface; no independently scrolling card inside the transcript. Verified by test asserting no nested scroll container and manual check.
- [ ] An optional Active Work Shelf near the composer mirrors running/background runs; selecting an item navigates to the transcript owner or opens the same inspector; shelf state never becomes canonical. Toggle default and persistence decided by Decision. Verified by jsdom tests + manual background-run walkthrough.
- [ ] When a validated structured report (spec 005) exists, the run's terminal presentation promotes the conclusion into Narrative per docs/11 (terminal Subagent conclusions promoted into the answer); otherwise today's text rendering stands.
- [ ] Every existing lifecycle regression suite stays green: queued/running abort, dynamic capacity, late events, orphaning, hydrate retry cancellation/rejection, session switching, pop-out owner realms, virtual scroll anchoring.

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
| WS-01 | `AgentRun` projection entity + derivation from tool-call subagent state, parent/child links, timing/usage | Codex | In progress | Spec 004 WS-02 (run metadata), spec 006 WS-01 (status vocabulary) | Projection unit tests incl. nested runs and reload hydration |
| WS-02 | Agent Group summary + expansion to Activity rows | Codex | Pending | WS-01, spec 006 WS-03 | jsdom tests; manual multi-agent scenario |
| WS-03 | Run timeline expansion within measured virtual row + inspector surface; no nested scroll | Codex | Pending | WS-02 | jsdom test asserting scroll-container invariants; manual check |
| WS-04 | Structured-report terminal presentation (Narrative promotion) with text fallback | Codex | Pending | WS-01, spec 005 WS-04 | Renderer tests over report and text fixtures |
| WS-05 | Active Work Shelf (default off) with owner navigation and attention state | Codex | Pending | WS-01 | jsdom tests; manual background-run walkthrough incl. tab switch and pop-out |
| WS-06 | Lifecycle regression sweep + before/after traces (20-agent scenario) with spec 001 harness | Codex | Pending | WS-01..WS-05 | Full `npm run test:coverage`; recorded traces |

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

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: tool-call-nested subagent model confirmed in `foundation` types, `ToolCallView.tsx`, `SubagentManager.ts`, `streamSubagentLifecycle.ts`.
- Remaining: all workstreams.
- Blockers: depends on spec 004 (run metadata), spec 005 (report schema), spec 006 (status vocabulary, ActivityRow); start only after those land.
- Next action: none until dependencies complete; then claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
