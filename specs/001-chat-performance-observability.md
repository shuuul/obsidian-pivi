---
id: "001"
title: "Chat performance observability harness and budgets"
status: Active
created: 2026-07-15
updated: 2026-07-15
coordinator: "Codex"
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

- [x] A dev-only trace recorder exists that captures, per session: runtime-event-to-projection-commit-and-paint latency, commits per frame and per second, mounted virtual rows and DOM node counts, Markdown render count and duration, long tasks (`PerformanceObserver` `longtask`), scroll-anchor drift, and heap samples before/after a scenario. Verified by running it in a real vault and exporting one JSON trace file. Chromium `performance.memory` is recorded when available and otherwise marked unavailable; full DevTools heap snapshots remain an explicit manual protocol step.
- [x] The recorder is compiled out of or inert in production builds (no `console.log`, no timers when disabled). Verified by `npm run build` plus a grep of `main.js` for the debug namespace, and by `npm run check:boundaries`.
- [x] A fixture generator script can create test sessions in a vault's `.pivi/sessions/`: 1K messages, 5K messages, one 100KB Markdown message, 20 Agent runs. Verified in the configured vault with the real Pi `SessionManager`, followed by an Obsidian reload with no captured errors.
- [x] The measurement protocol (scenarios, environment fields to record: Obsidian/Pivi version, window type main/pop-out, scenario shape) is written down in docs, and one baseline run is recorded before specs 002-004 change behavior. Scenarios include 1K/5K cold open, older-page load, 100KB Markdown streaming, 20 Agent runs, scrolling away from the end, late background events, repeated prepend, and session switching.
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
| 2026-07-15 | Dev builds expose explicit start, heap-sample, and stop/export Obsidian commands; production builds remove the recorder wiring with the existing `process.env.NODE_ENV` build constant | Gives real-vault profiling an intentional lifecycle while keeping production free of commands, timers, observers, and the debug namespace | WS-02 |
| 2026-07-15 | Trace JSON is written under vault-local `.pivi/perf-traces/` with environment and scenario metadata; no trace data enters settings or sessions | Keeps exported evidence next to the measured vault without changing durable product state | WS-02, WS-04 |
| 2026-07-15 | Automatic heap evidence uses Chromium `performance.memory` when available and records explicit unavailability otherwise; full heap snapshots are captured manually in DevTools when required | Browser JavaScript has no portable heap-snapshot API; the protocol must preserve that limitation rather than inventing precision | WS-02, WS-04 |
| 2026-07-15 | The start command reads an optional one-line `.pivi/perf-scenario.txt`, defaulting to `manual` | Obsidian CLI cannot execute a command blocked on `window.prompt`; a vault-local dev input keeps scenario runs scriptable without adding settings or session state | WS-02, WS-04 |
| 2026-07-15 | The 100KB streaming scenario uses a development-only synthetic turn driven through the active tab's real `ChatState`, projection store, React message list, and Obsidian Markdown adapter | A terminal JSONL fixture cannot produce streaming phases, while a live model would be costly, capped, and non-deterministic; the synthetic turn is restored out of memory and production tree-shaking removes the capability | WS-04 |
| 2026-07-15 | Message row ResizeObserver processing is deferred to the next animation frame | Repeated real-window session switching reproduced Chromium's undelivered-notification loop even with 2.5-second dwell; TanStack Virtual 3.14.6 documents this option for heavy DOM mutation and this exact warning, with an accepted one-frame measurement delay | WS-04 |
| 2026-07-15 | Session-switch measurement uses ten development-only in-memory tabs, each with 100 deterministic messages, while both debounced and immediate tab persistence are suspended | The scenario needs realistic tab/React mount churn, not the user's durable tab bindings; synthetic tabs never bind session files and are removed before persistence resumes | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `ChatPerfRecorder` interface + no-op default, hook points in projection store commit/flush/paint, MessageList mount/measure/anchor drift, Markdown adapter mount/update | Codex | Done | None | `npm run test -- tests/pivi-react`, `npm run check:boundaries` |
| WS-02 | Dev-only concrete recorder wired from app composition (`src/app`), enabled by an explicit debug toggle, exporting JSON traces | Codex | Done | WS-01 | Manual: enable in vault, run scenario, inspect exported trace |
| WS-03 | `scripts/generate-perf-sessions.mjs` fixture generator (1K, 5K, 100KB Markdown, 20 Agent runs) | Codex | Done | None | `node scripts/generate-perf-sessions.mjs <vault>` then open sessions in Obsidian |
| WS-04 | Measurement protocol + baseline results recorded (scenarios from docs/11: streaming, scroll away from end, late background events, repeated prepend, session switch, cold open) | Codex | Done | WS-02, WS-03 | Baseline JSON traces attached/linked in Progress and handoff |
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

### 2026-07-15 — Activation and observability decisions — Codex

- Changed: activated the spec, assigned coordination, aligned recorder coverage with `docs/11`, and decided the dev command lifecycle, vault-local export path, production elimination strategy, and heap-measurement semantics.
- Evidence: `docs/11-chat-ui-evolution.md` Performance observability requires paint, scroll-anchor, cold-open, and older-page evidence; the production build already replaces `process.env.NODE_ENV` through `build/create-build-options.mjs`.
- Remaining: all implementation workstreams; WS-01 is claimed.
- Blockers: none.
- Next action: implement the recorder contract and presentation hook points in WS-01.

### 2026-07-15 — WS-01 recorder seam — Codex

- Changed: added the disabled-by-default `ChatPerfRecorder` contract; instrumented projection event/commit/paint, virtual row and DOM counts, prepend anchor drift, and real host Markdown render duration; injected the same recorder into the Markdown adapter through the tab projection store.
- Evidence: `npm run typecheck`; `npm run lint`; `npm run check:boundaries`; `npm run test -- --runInBand tests/pivi-react tests/unit/app/ui/createStreamingMarkdownContentAdapter.test.ts` (24 suites, 169 tests); `npm run build`; `obsidian reload`; `obsidian dev:errors` (`No errors captured.`).
- Remaining: WS-02 through WS-05.
- Blockers: none.
- Next action: implement the development-only concrete recorder and explicit trace lifecycle commands in WS-02.

### 2026-07-15 — WS-02 development recorder and export — Codex

- Changed: added a versioned app-owned recorder with projection latency/paint correlation, virtual/DOM samples, Markdown timings, scroll drift, long-task observers, heap samples, and vault-local JSON export; injected it explicitly through app composition; added development-only start/sample/stop commands and CLI-safe scenario input.
- Evidence: `npm run typecheck`; `npm run lint`; `npm run check:boundaries`; full `npm run test -- --runInBand` (228 suites, 1,683 tests); production `npm run build` plus negative grep for `pivi-chat-perf-v1` and all debug command IDs; `npm run check:bundle-size` (2.84 MB); development bundle registered all three commands in Obsidian; real-vault smoke trace `2026-07-15T09-25-14-928Z-manual.json` exported with schema `pivi-chat-perf-v1`, Obsidian 1.13.2 / Pivi 0.9.0 metadata, main-window long-task support, three heap samples, and a virtual-row sample; production bundle restored and `obsidian dev:errors` reported `No errors captured.`
- Remaining: WS-03 through WS-05.
- Blockers: none. CLI cannot create hidden `.pivi` files directly in this environment, so the smoke run used the documented `manual` fallback; named baseline runs may write the one-line scenario file through the vault adapter or filesystem.
- Next action: implement deterministic Pi-compatible performance session fixtures in WS-03.

### 2026-07-15 — WS-03 deterministic performance sessions — Codex

- Changed: added a single-purpose generator for fixed 1K-message, 5K-message, exact 100KB Markdown, and 20-completed-Agent-run JSONL sessions; added regression coverage for shape, linear parent chains, exact scenario sizes, and upstream Pi parser compatibility.
- Evidence: `node --check scripts/generate-perf-sessions.mjs`; focused Jest (2 tests); test-project typecheck and focused ESLint; generated all four files in the configured vault; opened each file through the installed `@earendil-works/pi-coding-agent` `SessionManager`; `obsidian reload`; `obsidian dev:errors` (`No errors captured.`).
- Remaining: WS-04 measurement protocol/baseline and WS-05 budgets.
- Blockers: none.
- Next action: document the measurement protocol and capture main-window plus pop-out baseline traces in WS-04.

### 2026-07-15 — WS-04 deterministic streaming driver — Codex

- Changed: added a development-only semantic capability and command that injects a synthetic user/assistant turn into the active `ChatState`, streams exactly 102,400 ASCII Markdown bytes in 64 animation-frame chunks through the real projection and Markdown adapter, then restores the original in-memory messages and streaming state.
- Evidence: focused Jest (22 tests); source/test typecheck; focused ESLint; boundary checks; production build negative grep for the command and synthetic message marker; real Obsidian trace `2026-07-15T09-53-37-750Z-100kb-markdown-stream-main-v2.json` recorded 64 streaming Markdown segment renders plus one terminal render, 67 projection commits, 66 paints, and one long task; `obsidian dev:errors` reported `No errors captured.`; production bundle restored.
- Remaining: record the other fixed main/pop-out scenarios, write and attach the baseline protocol/results, then establish budgets in WS-05.
- Blockers: none.
- Next action: capture the complete pre-002 baseline matrix with the deterministic fixture and streaming drivers.

### 2026-07-15 — WS-04 session-switch ResizeObserver correction — Codex

- Changed: enabled TanStack Virtual's animation-frame ResizeObserver processing for the dynamically measured message list and documented the deliberate one-frame measurement latency.
- Evidence: before the change, both 1.1-second and 2.5-second fixture-tab switching reproduced `ResizeObserver loop completed with undelivered notifications.`; after the change, the same four-switch real-Obsidian scenario exported `2026-07-15T14-24-13-762Z-session-switching-resize-observer-fix.json` with 25 maximum mounted rows, 758 maximum DOM nodes, and 117 ms maximum long task, while `obsidian dev:errors` reported `No errors captured.`; focused MessageList/ChatShell Jest passed (22 tests); production build and reload passed. Reference: [TanStack Virtual `useAnimationFrameWithResizeObserver`](https://tanstack.com/virtual/latest/docs/api/virtualizer#useanimationframewithresizeobserver).
- Remaining: rerun and attach the clean baseline matrix, write the protocol/results, then establish budgets in WS-05.
- Blockers: none.
- Next action: repeat the complete baseline matrix with the corrected ResizeObserver cadence.

### 2026-07-15 — WS-04 isolated session-switch driver — Codex

- Changed: added a development-only fixed 10-tab / 20-switch workload with 100 deterministic messages per tab; the adapter suppresses both ordinary and immediate tab-state persistence for the complete create/switch/cleanup scope, restores the original active tab, and removes every synthetic tab.
- Evidence: source and test typecheck; focused Jest (25 tests); lint; boundary/spec checks; real Obsidian trace `2026-07-15T14-48-03-523Z-manual.json` recorded 710 events across projection commits, Markdown renders, virtual-row samples, long tasks, and heap samples; after the workload the DOM contained the original three tabs and zero synthetic tabs; `.pivi/tab-manager-state.json` retained SHA-256 `a2fd6501834624e92fd2299840d172d76c438263fdb5d032d3d4aaf054392c5b`; production negative grep, deploy checksum, reload, and `obsidian dev:errors` passed.
- Remaining: rerun and attach the named clean baseline matrix, write the protocol/results, then establish budgets in WS-05.
- Blockers: none.
- Next action: capture the complete baseline matrix without mutating durable tab state.

### 2026-07-15 — WS-04 protocol and baseline — Codex

- Changed: documented the trace lifecycle, required environment metadata, fixed action for every scenario, production-restoration gate, comparison caveats, and the pre-002/003/004 baseline table in `docs/11-chat-ui-evolution.md`; captured a named post-fix isolated session-switch trace.
- Evidence: nine named `pivi-chat-perf-v1` traces cover main-window and pop-out cold open, older paging, repeated prepend, 20 Agent runs, scroll-away/late update, 100KB streaming, and isolated switching. The final switching trace recorded max 25 rows / 758 DOM nodes and left `.pivi/tab-manager-state.json` byte-identical; production was rebuilt/deployed and `obsidian dev:errors` returned `No errors captured.`
- Remaining: WS-05 numerical budgets and deterministic Jest enforcement.
- Blockers: none.
- Next action: turn baseline headroom into explicit scenario budgets and lock the deterministic subset in Jest.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
