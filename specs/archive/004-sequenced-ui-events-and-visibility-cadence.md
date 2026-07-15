---
id: "004"
title: "Sequenced Chat UI event protocol and visibility-aware cadence"
status: Completed
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 004 — Sequenced Chat UI event protocol and visibility-aware cadence

## Context

`docs/11-chat-ui-evolution.md` (step 4) requires one explicit, sequenced UI event plane and a visibility-aware publish cadence. Verified current state:

- At activation, a dormant `ChatUiEvent`/`dispatch()` path existed beside the real Pi → `StreamChunk` → `StreamController` → `ChatState.projectStreamChunk()` → whole-message queue. WS-01 removed that unused semantics implementation before WS-02 rebuilt one production `dispatch()` envelope around the real post-reducer publication seam.
- The production envelope now carries a stable `projectionScopeId`, nullable `sessionFile`/`openSessionId`, run/parent-run IDs, a producer-owned monotonic sequence, timestamp, applicable entity IDs, a typed text/tool/Agent cause, and the authoritative post-effect message snapshot. The store drops duplicate, late-after-terminal, missing-owner, and out-of-order events with content-free `PluginLogger` diagnostics.
- Active visible surfaces publish once per `ownerWindow.requestAnimationFrame`; inactive or hidden surfaces publish from a 250 ms owner-realm timer. The store remembers the last mounted realm while a tab is inactive, listens to that realm's `visibilitychange`, publishes one complete pending projection on return, and cancels old-realm work before a main/pop-out migration.
- Activation corrected the original flush map. WS-04 preserved turn finalization, stream reset/dispose, session create/load/switch/save, and tab teardown flushes; it added urgent raw-error, cancel, and outgoing UI-tab-switch flushes. Raw `done` still does not seal the run because footer/finalization mutations follow it; the explicit post-footer `run.terminal` is the seal.

## Goal and success criteria

Outcome: one production event plane with explicit ownership and ordering semantics, plus a reduced-cadence mode for hidden surfaces that never loses durable or terminal state.

- [x] Exactly one ingestion path remains. `dispatch()` is the production path fed by `ChatState`/`StreamController`, while `queueUpsert` is private. The old dormant event union was removed before the canonical union was rebuilt around the real reducer output. A grep-level architecture test asserts the single entry point.
- [x] Every event carries a stable `projectionScopeId`, nullable `sessionFile`/`openSessionId`, applicable message/entity IDs, a monotonic producer sequence, timestamp, `runId`, and nullable `parentRunId`. Text carries its append delta; tool/Agent causes carry typed upserts plus the authoritative post-effect message snapshot so the store does not duplicate reducer/service-effect semantics.
- [x] Defined and tested behavior for: duplicate sequence (idempotent drop), late event after terminal (drop), missing owner (drop), and out-of-order sequence (drop). Every drop emits a content-free `PluginLogger` diagnostic and each case has a unit test.
- [x] Visibility-aware cadence: hidden document/inactive surface publishes on a 250 ms owner-realm cadence, while (a) durable state still updates immediately, (b) terminal and error events flush immediately, (c) save/switch/close/unload flush synchronously, (d) returning to visibility publishes one complete projection, (e) background Subagent completion/attention state is never lost. Each guarantee has a test.
- [x] Owner-window visibility tests cover main window and pop-outs, including old-realm cancellation and real-Obsidian hidden-cadence traces through disposable surfaces.
- [x] No second durable event log is created; events remain in-memory transport only and JSONL remains the durable source.

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
| 2026-07-16 | Require `projectionScopeId`; allow session identity to be null until lazy binding | A first turn legitimately streams before finalization creates its durable session, so non-null `sessionFile`/`openSessionId` would reject valid events. Scope plus the binding epoch still gives the sequence allocator stable ownership | WS-02..WS-03 |
| 2026-07-16 | Carry typed causes and the authoritative post-effect message snapshot | Text deltas and tool/Agent upserts preserve protocol meaning, while the snapshot lets one store reconciliation path include complex service effects without replaying a second reducer | WS-02 |
| 2026-07-16 | Serialize fire-and-forget background Agent chunks per tab | Pi listeners may invoke async UI handlers concurrently; a Promise tail preserves arrival order before producer sequencing and prevents async completion order from becoming protocol order | WS-02..WS-03 |
| 2026-07-16 | Separate urgent projection flush from sealed run terminal | Raw `done`/`error` precede footer/finalization work and cannot safely close the run; late-event detection needs an explicit terminal event after final projection mutation | WS-03..WS-04 |
| 2026-07-16 | Drop rather than buffer all protocol anomalies | The authoritative durable message state remains upstream, buffering malformed transport events would add an unbounded second state machine, and the diagnostic identifies the producer defect without exposing message content | WS-03 |
| 2026-07-16 | Cache the last non-null owner realm and use a 250 ms hidden/inactive timer | Inactive tab React surfaces unmount and previously cleared the owner window, which caused synchronous publication. Retaining the realm preserves pop-out-correct timers without keeping DOM nodes or runtime objects in snapshots | WS-04..WS-05 |
| 2026-07-16 | Treat hidden commit/render/long-task counts as background-work proxies, not direct CPU time | The spec 001 recorder has no CPU-time sample; adding unsupported CPU claims would violate the performance evidence policy | WS-06 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Plane convergence decision + removal of the dead path (design note in this spec, then implementation) | Codex | Done | Spec 003 complete (subscribers stable) | Architecture/grep test: one ingestion entry point; `npm run test -- tests/pivi-react/chatUiStore.test.tsx` |
| WS-02 | Ownership/ordering metadata on all events + producer-side sequence allocator | Codex | Done | WS-01 | New unit tests for metadata presence and monotonicity |
| WS-03 | Anomaly semantics: duplicate, late-after-terminal, missing-owner, out-of-order; `PluginLogger` diagnostics | Codex | Done | WS-02 | One test per anomaly case |
| WS-04 | Visibility-aware cadence with the five preserved guarantees; synchronous flush points unchanged | Codex | Done | WS-02 | Cadence unit tests + flush-point regression (StreamController/SessionController suites) |
| WS-05 | Main-window + pop-out visibility tests; manual pop-out validation in Obsidian | Codex | Done | WS-04 | Extended owner-realm suites; manual per deploy flow |
| WS-06 | Hidden-window before/after background-work proxy via spec 001 commits/renders/long tasks | Codex | Done | WS-04, spec 001 | Recorded traces in Progress and handoff |

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

### 2026-07-16 — WS-02 sequenced producer envelope — Codex

- Changed: rebuilt `ChatProjectionStore.dispatch()` as the sole production mutation boundary. `ChatState` allocates metadata and sequence per projection scope/binding, emits typed text/tool/Agent causes with the final message snapshot, resets the sequence when durable binding changes, and supplies stable tab/session identity. Background Agent chunks now run through a per-tab Promise tail before publication.
- Evidence: focused protocol/projection/controller tests passed 50/50; the broader chat lifecycle selection passed 82/82; typecheck and lint passed. A new architecture regression finds only `projectionStore.dispatch()` among production mutation calls and verifies `queueUpsert` is private. Tests prove nullable first-turn ownership, monotonic sequences, rebinding reset, text delta metadata, tool/Agent IDs, child/parent run linkage, and background arrival-order serialization.
- Problems recorded: session identity is legitimately null until lazy save; the old terminal/flush map overstated raw error/done/cancel guarantees; typed causes cannot replace the authoritative post-effect snapshot without duplicating complex reducers; the recorder exposes only background-work proxies rather than CPU time.
- Remaining: validate envelopes and maintain per-scope/run sequence and terminal state; emit diagnostics for duplicate, late, missing-owner, and out-of-order events.
- Blockers: none.
- Next action: add the WS-03 protocol gate with injected diagnostics, explicit run terminal events, and anomaly tests.

### 2026-07-16 — WS-03 protocol anomaly gate — Codex

- Changed: the projection store now validates binding ownership and monotonic sequence before applying an event, seals main and child runs only after their final mutation, and drops duplicate, out-of-order, missing-owner, and late-after-terminal events. Diagnostics contain only protocol identity and entity IDs; background chunks without an owning message are also logged without payload content.
- Evidence: four focused suites passed 40/40, including one store test for every anomaly and producer tests for rebinding/child-run ownership. Typecheck, lint, architecture, package README, i18n dead-key, and spec checks passed. The architecture test confirms `dispatch()` remains the sole production ingestion boundary.
- Problem found and fixed: `messages.replace` initially cleared protocol state while processing its own accepted event, causing the next sequence to be misclassified as missing-owner. Protocol state now survives replacement and is cleared only on owner rebinding or store disposal; the focused producer tests cover the regression.
- Remaining: implement owner-realm visibility cadence and close the audited urgent flush gaps without treating pre-footer raw `done`/`error` as sealed terminals.
- Blockers: none.
- Next action: add explicit active-surface/owner-document scheduling state and cadence tests for visible, inactive, hidden, visibility return, realm migration, and synchronous lifecycle flushes.

### 2026-07-16 — WS-04 visibility cadence and lifecycle flushes — Codex

- Changed: `ChatProjectionStore` now distinguishes active/visible rAF cadence from inactive/hidden 250 ms timer cadence, using only the owner window realm. `ActiveChatUiBridge` marks the outgoing store inactive and incoming store active. Visibility return or surface reactivation publishes one complete pending projection immediately; realm migration cancels the old frame/timer/listener first. Raw error, cancellation, and outgoing tab switch now flush urgently without sealing the main run.
- Evidence: the focused lifecycle/presentation selection passed 10 suites / 129 tests; typecheck, lint, and all boundary checks passed. Tests cover hidden and inactive cadence, visibility and activity return, terminal flush, durable state immediacy, attention state, cancel/error/tab-switch flush, ActiveChatUiBridge activity, and main-to-pop-out realm migration.
- Problem found and fixed: `MessageList` unmounts inactive surfaces and called `setOwnerWindow(null)`; clearing the realm made every inactive event flush synchronously. The store now treats the last non-null window as a scheduling realm until migration/disposal and keeps snapshots free of DOM/runtime objects.
- Remaining: run the built/deployed main-window and disposable pop-out validation, then capture hidden-window background-work proxy traces through the spec 001 recorder.
- Blockers: none.
- Next action: build/deploy, exercise only synthetic disposable surfaces, and confirm clean Obsidian errors before trace collection.

### 2026-07-16 — WS-05/WS-06 owner-realm validation and traces — Codex

- Changed: deployed the development bundle and ran the fixed 102,400-byte / 64-chunk workload with hidden visibility in the main renderer and in a disposable floating Pivi leaf. Both workloads used disposable unbound tabs, restored the prior active tab, and removed their synthetic state. Durable protocol/cadence conclusions were synchronized into `docs/11-chat-ui-evolution.md`, root `AGENTS.md`, and the nearest React/chat guidance.
- Evidence: main trace `2026-07-15T21-04-31-847Z-spec-004-hidden-main.json` and pop-out trace `2026-07-15T21-07-08-263Z-spec-004-hidden-popout.json` each recorded 5 synthetic projection commits (2 immediate, 2 hidden-timer, 1 explicit flush), 4 synthetic Markdown renders, and 0 long tasks. The corresponding visible spec 003 traces recorded 67 commits, 65 renders, and 1 workload long task. Each accepted trace identifies only its expected owner window; the pop-out workload completed 102,400 bytes / 64 chunks in 1,531.9 ms.
- Problems recorded: macOS denied System Events assistive access, so no OS-level hiding was attempted further; the owner document's configurable visibility state plus real `visibilitychange` event exercised the exact scheduler input instead. A first CLI-created-window attempt routed later commands back to main and produced a mislabeled trace; recorder metadata exposed the mismatch, that trace was deleted, and the accepted run addressed the floating leaf/window directly. These proxies do not measure CPU time.
- Cleanup: the temporary scenario file and rejected trace were removed; the disposable floating window was closed; floating-window count, synthetic DOM marker count, and captured Obsidian errors were all zero.
- Remaining: full coverage/type/lint/boundary/build/bundle/production-restoration gate, then archive this spec.
- Blockers: none.
- Next action: run the complete verification matrix and record production artifact identity/marker cleanup.

### 2026-07-16 — Final protocol/lifecycle audit fixes — Codex

- Problems found: (1) the pending queue retained a mutable durable-message reference, allowing a later rejected event's upstream mutation to alias into an earlier accepted event; (2) child run ownership used the current stream generation at completion and could drift across turns; (3) service unsubscription occurred after controller/store disposal and queued/in-flight background work lacked disposal invalidation; (4) page reveal/prepend still bypassed `dispatch()` while the architecture test omitted those method names.
- Changed: accepted queued events now deep-snapshot immediately; background Agent IDs retain their first parent run; `StreamController` rejects work before and after awaits once disposed; tab teardown unsubscribes service callbacks first; page reveal/prepend are sequenced events and their store helpers are private. The architecture scan now includes React message code and all former mutation helper names.
- Evidence: regressions keep an accepted event pending while mutating/rejecting the shared source, advance the parent generation before Agent completion, dispose with queued and in-flight background work, and verify paging has no direct mutation call. The focused audit selection passed 8 suites / 98 tests; typecheck, lint, architecture, package README, i18n dead-key, and spec checks passed.
- Production reload note: the first development-to-production hot reload logged one conservative `SessionIndexStaleError` while the old instance attempted teardown save against a changed live source. After clearing the buffer, a second idle production reload was clean with no console errors. No write was forced through the stale-source guard.
- Remaining: commit these audit fixes, rerun the full gate on the committed tree, fill the completion summary, and archive.
- Blockers: none.
- Next action: commit the audited implementation/documentation, then run the final coverage/build/reload matrix.

### 2026-07-16 — Final verification and production restoration — Codex

- Evidence: `npm run test:coverage -- --runInBand` passed 234 suites / 1,774 tests with statements/branches/functions/lines at 68.12%/57.17%/64.99%/69.55%. `npm run typecheck`, `npm run lint`, and `npm run check:boundaries` passed. Production build and bundle-size gate passed at 3,014,588 bytes (2.87 MB), leaving 2.13 MB headroom.
- Production restoration: source and deployed `main.js`, `manifest.json`, and `styles.css` matched byte-for-byte; debug recorder/workload markers were absent. Production reload reported no captured or console errors; synthetic DOM markers, floating windows, and the temporary performance scenario file were all absent.
- Remaining: none.
- Blockers: none.
- Next action: archive spec 004 and continue with spec 005.

## Completion summary

Delivered one sequenced, in-memory Chat projection event plane. `ChatState` owns projection scope/binding metadata and monotonic sequence allocation; events cover message, text, tool, Agent, truncation, page reveal/prepend, flush, and main/child terminal boundaries. The store validates ownership/order, snapshots accepted state, drops diagnosed anomalies, preserves stable keyed entities, and keeps JSONL as the only durable log. Background Agent work serializes per tab, retains its creation parent run across turns, and cannot publish after controller/tab disposal.

Projection cadence now distinguishes active visible surfaces (owner-window animation frame) from hidden or inactive surfaces (250 ms owner-realm timer). Visibility/activity return publishes one complete pending projection; main/pop-out realm migration cancels old work. Error, cancel, save, switch, close, unload, and terminal paths retain synchronous publication guarantees. Real-Obsidian disposable traces reduced the fixed hidden 100KB workload from the visible 67 commits / 65 renders / one workload long task to 5 commits / 4 renders / zero long tasks in both main and pop-out renderers. This is background-work proxy evidence, not a CPU-time claim.

Deviations and issues were recorded rather than hidden: first-turn session identity remains nullable behind a required projection scope; raw `done`/`error` does not seal a run before final footer work; System Events assistive access was unavailable so the exact owner-document visibility input was exercised directly; a misrouted CLI pop-out trace was rejected and deleted; and final audit found/fixed mutable pending aliasing, cross-turn child-run drift, teardown races, and paging bypass of the event plane.

Final verification passed 234 suites / 1,774 tests, global coverage 68.12% statements / 57.17% branches / 64.99% functions / 69.55% lines, typecheck, lint, all boundary/spec checks, production build, bundle budget, deployed-artifact identity, debug-marker cleanup, main/pop-out disposable runtime traces, production reload, and zero remaining synthetic/floating/temp artifacts. Durable conclusions are synchronized into `docs/11-chat-ui-evolution.md`, root `AGENTS.md`, `packages/pivi-react/AGENTS.md`, and `src/ui/chat/AGENTS.md`.
