---
id: "001"
title: "Chat performance observability harness and budgets"
status: Draft
created: 2026-07-15
updated: 2026-07-15
coordinator: "Unassigned"
---

# 001 — Chat performance observability harness and budgets

## Context

`docs/11-chat-ui-evolution.md` (Recommended sequence, step 1) requires real-app performance traces and budgets before the next optimization wave. Verified current state:

- Deterministic invariants exist only in Jest: `tests/pivi-react/chatUiStore.test.tsx` (hundreds of one-entity updates coalesce into one animation-frame commit; latest-100 projection of a 5K session; entity publishes do not notify unrelated messages) and `tests/pivi-react/MessageList.test.tsx` (5K transcript keeps mounted row count bounded by viewport + overscan).
- There is no real-Obsidian profiling harness, no trace recorder, and no perf budget other than `scripts/check-bundle-size.mjs`.
- The projection publish path is `ChatProjectionStore.queueUpsert()` in `packages/pivi-react/src/store/chatProjectionStore.ts` (coalesced per `ownerWindow.requestAnimationFrame`); Markdown renders through imperative adapters mounted by `src/app/ui/imperativeChatMessagePresentation.ts`.

Every later spec in this sequence (002 indexed reads, 003 granular subscriptions, 004 event protocol/cadence, 009-candidate Markdown cache) is required by docs/11 to prove improvements with before/after measurements. This spec creates the shared measurement infrastructure and records the baseline.

## Goal and success criteria

Outcome: a repeatable way to measure chat performance in a real Obsidian window, with fixed scenarios, a recorded baseline, and explicit budgets.

- [ ] A dev-only trace recorder exists that captures, per session: runtime-event-to-projection-commit latency, commits per frame and per second, mounted virtual rows and DOM node counts, Markdown render count and duration, long tasks (PerformanceObserver `longtask`), and heap snapshots before/after a scenario. Verified by running it in a real vault and exporting one JSON trace file.
- [ ] The recorder is compiled out of or inert in production builds (no `console.log`, no timers when disabled). Verified by `npm run build` plus a grep of `main.js` for the debug namespace, and by `npm run check:boundaries`.
- [ ] A fixture generator script can create test sessions in a vault's `.pivi/sessions/`: 1K messages, 5K messages, one 100KB Markdown message, 20 Agent runs. Verified by running the script and opening the sessions in Obsidian.
- [ ] The measurement protocol (scenarios, environment fields to record: Obsidian/Pivi version, window type main/pop-out, scenario shape) is written down in docs, and one baseline run is recorded before specs 002-004 change behavior.
- [ ] Budgets are stated as numbers (for example max commits/second while streaming, max mounted rows, max long-task count per scenario) and the deterministic subset is enforced in Jest.

## Scope and non-goals

In scope:

- Trace instrumentation seams inside `packages/pivi-react/src/store/chatProjectionStore.ts`, `packages/pivi-react/src/chat/messages/MessageList.tsx`, and the Markdown adapter mount path in `src/app/ui/imperativeChatMessagePresentation.ts` (hook points only, behavior unchanged when disabled).
- A single-purpose Node script under `scripts/` for fixture session generation (follow `scripts/AGENTS.md`: runnable as `node scripts/<name>`).
- Baseline measurement in the configured `.env.local` vault, main window and one pop-out.

Not in scope:

- Any optimization work (belongs to specs 002-004).
- TanStack Virtual `directDomUpdates` investigation (explicit docs/11 non-goal).
- Markdown segment cache (docs/11 step 9; only justified after this spec's traces exist).
- Provider tokenizers or transcript search.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Instrumentation hooks live behind one injected recorder interface, default no-op | Keeps `packages/pivi-react` free of host/debug imports and satisfies the no-production-logging rule | WS-01, WS-02 |
| 2026-07-15 | Fixture sessions are generated as Pi-compatible JSONL files, not through the live runtime | Deterministic scenario shapes; reuses `tests/helpers/` message factories where possible | WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `ChatPerfRecorder` interface + no-op default, hook points in projection store commit/flush, MessageList mount/measure, Markdown adapter mount/update | Unassigned | Pending | None | `npm run test -- tests/pivi-react`, `npm run check:boundaries` |
| WS-02 | Dev-only concrete recorder wired from app composition (`src/app`), enabled by an explicit debug toggle, exporting JSON traces | Unassigned | Pending | WS-01 | Manual: enable in vault, run scenario, inspect exported trace |
| WS-03 | `scripts/generate-perf-sessions.mjs` fixture generator (1K, 5K, 100KB Markdown, 20 Agent runs) | Unassigned | Pending | None | `node scripts/generate-perf-sessions.mjs <vault>` then open sessions in Obsidian |
| WS-04 | Measurement protocol + baseline results recorded (scenarios from docs/11: streaming, scroll away from end, late background events, repeated prepend, session switch, cold open) | Unassigned | Pending | WS-02, WS-03 | Baseline JSON traces attached/linked in Progress and handoff |
| WS-05 | Budget numbers agreed and deterministic subset added to Jest (extend `chatUiStore.test.tsx` / `MessageList.test.tsx`) | Unassigned | Pending | WS-04 | `npm run test:coverage` |

Step-by-step guidance for WS-01 (for the implementing agent):

1. Define `ChatPerfRecorder` (methods like `onCommit(entityCounts, elapsedMs)`, `onFlush(reason)`, `onRowMountChange(mounted)`, `onMarkdownRender(durationMs)`) next to the projection store types.
2. Add an optional recorder parameter with a module-level no-op default; call sites must be one line each and must not allocate when disabled.
3. Do not import Obsidian, Node, or app modules inside `packages/pivi-react` (architecture check will fail otherwise).

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- Manual scenario runs per docs/11 Performance observability list, recorded with environment metadata (Obsidian version, Pivi commit, window type, scenario name).
- Confirm `obsidian dev:errors` returns `No errors captured.` after a recorder-enabled session.

## Documentation sync

- Numbered developer docs: update `docs/11-chat-ui-evolution.md` (Performance observability section) to point at the concrete recorder and protocol once they exist.
- Nearest local guidance: `packages/pivi-react/AGENTS.md` (recorder seam), `scripts/AGENTS.md` (new script).
- Parent/package guidance: `src/app/AGENTS.md` if composition wiring is added.
- Root guidance and roadmap: `AGENTS.md` quality snapshot once budgets are enforced.

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: file paths and current-state claims verified by read-only exploration on 2026-07-15.
- Remaining: all workstreams.
- Blockers: none.
- Next action: claim WS-01 and WS-03 (parallelizable).

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
