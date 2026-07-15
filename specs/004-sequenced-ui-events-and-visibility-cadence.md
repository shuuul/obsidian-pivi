---
id: "004"
title: "Sequenced Chat UI event protocol and visibility-aware cadence"
status: Active
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 004 — Sequenced Chat UI event protocol and visibility-aware cadence

## Context

`docs/11-chat-ui-evolution.md` (step 4) requires one explicit, sequenced UI event plane and a visibility-aware publish cadence. Verified current state:

- A `ChatUiEvent` union exists in `packages/pivi-react/src/store/chatProjectionStore.ts` (`messages.replace`, `message.upsert`, `text.append`, `tool.upsert`, `agent.patch`, `messages.truncate`, `terminal.flush`) but `ChatProjectionStore.dispatch(event)` is **never called from production code**. The real path is: Pi engine `piAgentEventAdapter.ts` → `StreamChunk` → `src/ui/chat/controllers/StreamController.ts` → `ChatState.projectStreamChunk()` (pure reducers in `packages/pivi-react/src/store/chatStreamReducer.ts`) → `projectionStore.queueUpsert(message)` whole-message upserts. Two parallel planes where one is dead code is a maintenance hazard.
- Events carry only `messageId` / `blockId` / `agentId`. None of the docs/11 ownership/ordering metadata exists: no `sessionFile`, `openSessionId`, `runId`, `parentRunId`, `sequence`, `timestamp`. Duplicate/late/missing-owner/out-of-order behavior is undefined.
- Publish cadence is once per `ownerWindow.requestAnimationFrame` (owner window set by `MessageList` from the scroll element's document; pop-out safe; synchronous flush when no owner window). There is no `visibilitychange`/`document.hidden` handling anywhere in `src/` or `packages/`.
- Synchronous flush points exist and must be preserved: `StreamController.ts` (terminal/error), `inputTurnPipeline.ts` (turn finalization), `InputController.ts` (cancel), `SessionController.ts` (save/switch/reset), `Tab.ts` (teardown).

## Goal and success criteria

Outcome: one production event plane with explicit ownership and ordering semantics, plus a reduced-cadence mode for hidden surfaces that never loses durable or terminal state.

- [ ] Exactly one ingestion path remains. Either `dispatch()` becomes the production path (fed by `ChatState`/`StreamController`) with `queueUpsert` reduced to an internal helper, or the dead `ChatUiEvent` members are deleted and the union is rebuilt around the real path. Decision recorded; no dual plane at completion. Verified by grep-level architecture test asserting a single entry point.
- [ ] Every event carries `sessionFile`, `openSessionId`, `messageId`, entity ID (`blockId`/`toolId`/`agentId` as applicable), a monotonic `sequence`, and `timestamp`; run-scoped events carry `runId`/`parentRunId`. Text stays append-delta; tool/Agent state uses typed upserts/patches (docs/11 shapes).
- [ ] Defined and tested behavior for: duplicate sequence (idempotent drop), late event after terminal flush (logged via `PluginLogger`, ignored or applied per decision), missing owner (event for unknown message/session dropped with diagnostic), out-of-order within a run (buffer-or-drop per decision). Each case has a unit test.
- [ ] Visibility-aware cadence: hidden document/inactive surface publishes on a slower cadence, while (a) durable state still updates immediately, (b) terminal and error events flush immediately, (c) save/switch/close/unload flush synchronously, (d) returning to visibility publishes one complete projection, (e) background Subagent completion/attention state is never lost. Each guarantee has a test.
- [ ] Owner-window visibility tests cover main window and pop-outs (extend the existing owner-realm suites, `tests/pivi-react/mountSurfaces.test.tsx` pattern).
- [ ] No second durable event log is created (docs/11 non-goal); events remain in-memory transport only.

## Scope and non-goals

In scope:

- `packages/pivi-react/src/store/chatProjectionStore.ts` (event union, sequencing, cadence), `chatStreamReducer.ts` alignment, `src/ui/chat/` producers (`ChatState`, `StreamController`, `SessionController`), and `ActiveChatUiBridge` if surface-activity signals are needed.
- A small sequence allocator owned by the producer side (per open session), so ordering is defined before any future remote/cross-process transport.
- Visibility signal sourcing from the owner window (`document.visibilityState` + workspace active-surface state), respecting the existing owner-window pattern.

Not in scope:

- Persisting events, AG-UI mapping, or remote transports (docs/11 defers these to a separate decision).
- Changing JSONL persistence or `message_ui` writes.
- New UI components.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Resolve the dual-plane hazard first: audit whether converging on `dispatch()` or on an enriched `queueUpsert` contract costs less churn, then commit | Dead `dispatch()`/`terminal.flush` code contradicts "one explicit event plane"; keeping both indefinitely is the worst outcome | WS-01 |
| 2026-07-15 | Sequence numbers are allocated in `src/ui/chat` (producer), not inside the React store | The store must be able to detect gaps/duplicates it did not create; docs/11 wants protocol semantics upstream of presentation | WS-02 |
| 2026-07-16 | Converge first on the real whole-message publication path, then enrich that single seam | `queueUpsert` is the only production stream entry and already feeds spec 003 reconciliation; the dormant granular mutations did not cover the real reducer/service-effect shapes and would create a second semantics implementation | WS-01..WS-02 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Plane convergence decision + removal of the dead path (design note in this spec, then implementation) | Codex | Done | Spec 003 complete (subscribers stable) | Architecture/grep test: one ingestion entry point; `npm run test -- tests/pivi-react/chatUiStore.test.tsx` |
| WS-02 | Ownership/ordering metadata on all events + producer-side sequence allocator | Codex | In progress | WS-01 | New unit tests for metadata presence and monotonicity |
| WS-03 | Anomaly semantics: duplicate, late-after-terminal, missing-owner, out-of-order; `PluginLogger` diagnostics | Codex | Pending | WS-02 | One test per anomaly case |
| WS-04 | Visibility-aware cadence with the five preserved guarantees; synchronous flush points unchanged | Codex | Pending | WS-02 | Cadence unit tests + flush-point regression (StreamController/SessionController suites) |
| WS-05 | Main-window + pop-out visibility tests; manual pop-out validation in Obsidian | Codex | Pending | WS-04 | Extended owner-realm suites; manual per deploy flow |
| WS-06 | Background CPU before/after measurement (hidden window streaming scenario) via spec 001 harness | Codex | Pending | WS-04, spec 001 | Recorded traces in Progress and handoff |

Guidance for low-context agents:

1. List every current flush call site before changing anything: search `flushProjection` and `projectionStore.flush` under `src/ui/chat/`. All of them must keep flushing synchronously.
2. `packages/pivi-react` must stay free of Obsidian imports; visibility signals arrive through the owner window reference or an injected surface-activity callback, never via `require('obsidian')`.
3. Do not silently swallow anomaly events; route diagnostics through the shared `PluginLogger` seam used by other fire-and-forget paths (root AGENTS.md quality item 4).
4. Timers must use the owner window realm (existing pattern in `chatProjectionStore.ts`), never the global `window`, or pop-outs will break.

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build`
- Regression: queued/running abort, late events, orphaning, hydrate retry, session switching suites listed in docs/11 stage-preservation rule stay green.
- Manual: stream in a hidden main window and a hidden pop-out; hide/show mid-stream; close vault mid-stream; confirm `obsidian dev:errors` clean.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Sequenced UI event protocol and Visibility-aware projection cadence sections updated to implemented semantics).
- Nearest local guidance: `packages/pivi-react/AGENTS.md` (store event contract), `src/ui/chat/AGENTS.md` (producer/sequencing ownership).
- Parent/package guidance: `src/ui/AGENTS.md` if the flush map changes.
- Root guidance and roadmap: `AGENTS.md` architecture status paragraph.

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: `dispatch()` confirmed unused in production; flush call sites enumerated; no visibility handling found in `src/` or `packages/`.
- Remaining: all workstreams.
- Blockers: WS-01 should start after spec 003 lands to avoid churn on the same store files.
- Next action: run the WS-01 convergence audit.

### 2026-07-16 — Activation and production-path audit — Codex

- Changed: activated spec 004 after spec 003 completed, assigned coordination and all workstreams to Codex, and started WS-01 without changing runtime behavior.
- Evidence: production mutations still enter `ChatProjectionStore` only through `ChatState.replaceAll`/`upsertNow`/`queueUpsert`/`flush`; `ChatProjectionStore.dispatch()` remains used only by two presentation tests. `MessageList` supplies the active owner window and clears it on unmount, so inactive-tab publication currently falls back to synchronous flush rather than a reduced owner-realm cadence.
- Remaining: choose the canonical production ingestion API, remove the unused alternative, then introduce producer-owned metadata/sequencing on that one path.
- Blockers: none; specs 001 and 003 are archived and supply the recorder plus stable entity subscribers.
- Next action: complete the WS-01 convergence decision against the current store and producer call graph.

### 2026-07-16 — WS-01 event-plane convergence — Codex

- Changed: removed the unused `ChatUiEvent` union, `dispatch()` switch, and dormant text/tool/Agent mutation helpers. The two presentation tests now exercise the same whole-message queue and keyed reconciliation used by production.
- Evidence: focused projection/tool tests passed 30/30; typecheck, lint, and boundaries passed. Source scan finds one production `projectionStore.queueUpsert()` caller under `src/ui/chat` and no `ChatUiEvent` or store `dispatch()` path.
- Remaining: replace that single raw queue call with the producer-owned metadata/sequence protocol, then define anomaly handling at the store boundary.
- Blockers: none.
- Next action: design the smallest event envelope that describes the real post-reducer message publication without duplicating durable reducer semantics.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
