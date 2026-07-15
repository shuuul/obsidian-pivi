---
id: "003"
title: "Granular block, tool, and Agent-run subscriptions in message interiors"
status: Completed
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 003 — Granular block, tool, and Agent-run subscriptions in message interiors

## Context

`docs/11-chat-ui-evolution.md` (step 3) wants the hottest message interiors on narrow entity subscriptions so one block/tool/Agent update stops invalidating the whole message row. Verified current state:

- `packages/pivi-react/src/store/chatProjectionStore.ts` already exposes entity-addressed state and subscriptions: `ChatBlockEntity` (`${messageId}:block:${index}`), `ChatToolEntity` (tool id), `ChatAgentRunEntity` (subagent `agentId ?? id`), with hooks `useChatProjectionBlock/Tool/AgentRun`. Tests in `tests/pivi-react/chatUiStore.test.tsx` already prove entity publishes do not notify unrelated message subscribers.
- The shipped transcript does not use them: `ProjectedMessageRow` in `packages/pivi-react/src/chat/messages/MessageList.tsx` subscribes per whole message via `useChatProjectionMessage` and renders `MessageView` → `AssistantContentView` → `TextBlockView` / `ToolCallView` as plain props. Every streaming text delta re-renders the entire row, including sibling blocks and tool shells.
- Updates enter the store as whole-message upserts: `ChatState.notifyMessageChanged()` → `projectionStore.queueUpsert(message)` (from `src/ui/chat/`), not granular events. The activation audit found that the store originally rebuilt and notified every entity in the message, so entity reconciliation is a correctness prerequisite for narrowing the React side independently of spec 004's event-plane work.
- Virtual rows are measured dynamically (`measureElement`, estimate 120px, overscan 6); a block growing must trigger remeasure of its own row only.

## Goal and success criteria

Outcome: streaming text, tool status, and subagent status updates re-render only the affected entity's component and remeasure only its virtual row.

- [x] `TextBlockView` (or a thin wrapper) subscribes through `useChatProjectionBlock` for its own block ID; a streaming delta does not re-render sibling blocks or tool views. Verified by a deterministic Jest render-count test modeled on `AssistantContentView.test.tsx` mount-count assertions.
- [x] `ToolCallView` subscribes through `useChatProjectionTool`; a tool status flip re-renders only that tool shell. Same verification style.
- [x] The subagent slot subscribes through `useChatProjectionAgentRun`; subagent status/description updates do not re-render the owning message row. The imperative `SubagentRenderer`/`AsyncSubagentRenderer` adapters keep receiving updates via their existing `update` path.
- [x] The message row keeps subscribing only to shell/ordering metadata (docs/11 `MessageRow` role); block additions/removals still re-render the row.
- [x] Row remeasure still happens when a subscribed block grows (TanStack `measureElement` reruns), verified by a test and manual streaming in Obsidian (no overlap/clipping, anchored follow keeps working).
- [x] Deterministic render-count tests prove that a block, tool, or Agent-run update does not rerender sibling entities or the owning row shell. Spec 001 main-window and pop-out traces prove the unchanged 100KB workload stays within its projection, Markdown, virtualization, long-task, and paint budgets. The trace recorder does not expose React component commits, and this spec intentionally keeps whole-message ingestion, so trace commit counts are not used as the isolation proof.

## Scope and non-goals

In scope:

- `packages/pivi-react/src/chat/messages/`: `MessageList.tsx`, `MessageView.tsx`, `AssistantContentView.tsx`, `ToolCallView.tsx`, plus small subscription wrapper components.
- Making sure `queueUpsert()` entity diffing publishes the exact entity keys the new subscribers need (verify against store tests; extend if a needed entity change is not published).
- Memoization boundaries: `MessageView` stays memoized; entity components memo on their snapshot identity after the store reconciliation gate preserves unchanged identities.

Not in scope:

- Changing the runtime → store path or introducing granular events (spec 004).
- Moving subagent rendering from imperative adapters to React (spec 008 territory).
- Persistence or `ChatMessage` shape changes; docs/11: normalized entities are a UI read model only.
- TanStack `directDomUpdates`.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Adopt entity subscriptions only where profiling justifies (text blocks, tools, agent runs), not for every leaf | docs/11 explicitly scopes to "hottest message interiors"; avoids subscription-count explosion | WS-01..WS-03 |
| 2026-07-15 | Keep whole-message `queueUpsert` as the ingestion API in this spec | Store-side diffing already yields entity granularity; changing ingestion belongs to spec 004 | All |
| 2026-07-16 | Add entity reconciliation as a prerequisite correctness gate | The activation audit disproved the original assumption that whole-message upserts already preserved unchanged entity identities; removals also need to notify active subscribers | WS-00..WS-04 |
| 2026-07-16 | Use deterministic component tests as the optimization proof and Spec 001 traces as non-regression evidence | The recorder measures projection commits and actual host Markdown renders, not React sibling renders. Whole-message ingestion remains in scope for spec 004, and the one-block 100KB workload must still render its affected block on every chunk, so lower trace counts would be an invalid success condition for this spec | WS-05..WS-06 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-00 | Reconcile block/tool/agent entity snapshots on whole-message upsert; preserve unchanged identities, publish changed entities only, and notify removals | Codex | Done | None | Extended `tests/pivi-react/chatUiStore.test.tsx` + typecheck/lint/boundaries |
| WS-01 | Block-level subscription: wrapper component around `TextBlockView`/`ThinkingBlockView` using `useChatProjectionBlock`; render-count regression test | Codex | Done | WS-00 | `npm run test -- tests/pivi-react/AssistantContentView.test.tsx` (extended) |
| WS-02 | Tool-level subscription in `ToolCallView` via `useChatProjectionTool`; status-flip render isolation test | Codex | Done | WS-00 | `npm run test -- tests/pivi-react/ToolCallView.test.tsx` (extended) |
| WS-03 | Agent-run subscription for `ImperativeSubagentSlot` via `useChatProjectionAgentRun`; keep adapter `update` contract intact | Codex | Done | WS-00 | Extended jsdom test + projection store tests |
| WS-04 | Row-shell narrowing: `ProjectedMessageRow`/`MessageView` subscribe to shell metadata; block list identity churn audit | Codex | Done | WS-01..WS-03 | `tests/pivi-react/MessageList.test.tsx` mounted-row invariants stay green |
| WS-05 | Remeasure correctness: growing subscribed block remeasures its row; manual streaming check in main + pop-out windows | Codex | Done | WS-01 | Jest + manual per root AGENTS.md deploy flow (`npm run build && obsidian reload`) |
| WS-06 | Deterministic isolation evidence plus Spec 001 main/pop-out non-regression traces | Codex | Done | WS-01..WS-05, spec 001 | Render-count tests and recorded traces in Progress and handoff |

Guidance for low-context agents:

1. Read `packages/pivi-react/AGENTS.md` and `src/ui/chat/rendering/AGENTS.md` first; do not import anything from `src/**` into `packages/pivi-react` (architecture check enforces this).
2. Entity IDs: block ID format is `${messageId}:block:${index}`; confirm the exact helper in `chatProjectionStore.ts` instead of hand-building strings in components.
3. When adding render-count tests, copy the explicit `mounts` array pattern from `tests/pivi-react/AssistantContentView.test.tsx`.
4. Do not remove the existing prop-based render path until all consumers are migrated in the same change; no dead dual paths at completion.

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build`
- Deterministic render-isolation tests listed per workstream.
- Manual: stream a long response in Obsidian (main window and pop-out), scroll during streaming, expand/collapse tools, run a subagent; confirm anchoring and no visual regressions.
- Performance claims only with spec 001 before/after traces.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Block, tool, and Agent subscriptions section marked adopted).
- Nearest local guidance: `packages/pivi-react/AGENTS.md` (subscription pattern and when to use it).
- Parent/package guidance: `src/ui/chat/rendering/AGENTS.md` if adapter update contracts shift.
- Root guidance and roadmap: `AGENTS.md` architecture status paragraph on `ChatProjectionStore` usage.

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: dormant entity hooks confirmed in `chatProjectionStore.ts`; whole-row subscription confirmed in `MessageList.tsx`.
- Remaining: all workstreams.
- Blockers: soft dependency on spec 001 for the measurement criterion only; functional work can start immediately.
- Next action: claim WS-01 and WS-02 (parallelizable).

### 2026-07-16 — Activation and subscription audit — Codex

- Changed: activated spec 003 after spec 002 completed, assigned coordination and every workstream to Codex, and started WS-01. No presentation code changed in this step.
- Evidence: the existing store already publishes immutable block/tool/agent entity snapshots, while `ProjectedMessageRow` still consumes the whole message and passes mutable-looking content props through every interior component.
- Remaining: audit the exact component/adapter call graph and then implement WS-01 with a render-isolation regression test before widening the migration.
- Blockers: none; spec 001 and spec 002 are complete.
- Next action: introduce the smallest block subscription boundary without changing whole-message ingestion or the imperative Markdown adapter contract.

### 2026-07-16 — Entity reconciliation premise correction — Codex

- Changed: corrected the spec's false premise that whole-message upserts already diffed entity snapshots; added WS-00 as a prerequisite correctness gate before enabling dormant entity hooks.
- Evidence: activation audit found that every upsert recreated and notified all block/tool/agent entities, while removed entities were deleted without notifying their subscribers.
- Remaining: complete and verify keyed entity reconciliation, then resume WS-01.
- Blockers: none after adopting the corrected sequence.
- Next action: prove unchanged identity, changed-entity isolation, and removal notification in the projection store tests.

### 2026-07-16 — WS-00 entity reconciliation — Codex

- Changed: keyed block/tool/agent reconciliation now preserves structurally unchanged entity snapshots, publishes only changed entities, and notifies subscribers when entities disappear. Entity hooks use stable subscription and snapshot callbacks.
- Evidence: `tests/pivi-react/chatUiStore.test.tsx` passed 12/12; `npm run typecheck`, `npm run lint`, and `npm run check:boundaries` passed.
- Remaining: WS-01..WS-06.
- Blockers: none.
- Next action: complete the block-level subscription boundary and its sibling render-isolation test.

### 2026-07-16 — WS-01 block subscriptions — Codex

- Changed: projected message rows now give assistant content access to `ChatProjectionStore`; memoized text and thinking block wrappers subscribe to their canonical block IDs while the prop-based path remains available for consumers not yet migrated.
- Evidence: `tests/pivi-react/AssistantContentView.test.tsx` passed 10/10, including a two-block regression proving one streamed block update does not call the sibling Markdown adapter; typecheck, lint, and boundaries passed.
- Remaining: WS-02..WS-06; remove the temporary dual presentation path once all projected interior consumers are migrated.
- Blockers: none.
- Next action: add tool-level subscriptions without breaking contiguous tool-group aggregation.

### 2026-07-16 — WS-02 tool subscriptions — Codex

- Changed: projected single-tool shells subscribe by tool ID; projected step groups subscribe to a stable aggregate of their member IDs so group status stays current. Imperative tool islands now mount once per tool generation and receive entity changes through `update`.
- Evidence: focused projection/tool/content tests passed 37/37, including sibling tool render isolation, group aggregate status, and no-remount adapter updates; typecheck, lint, and boundaries passed.
- Remaining: WS-03..WS-06; subagent-only changes still share the nested tool snapshot until WS-03 separates that dependency.
- Blockers: none.
- Next action: subscribe the imperative subagent slot directly to the agent-run entity and decouple subagent-only patches from tool-shell identity.

### 2026-07-16 — WS-03 agent-run subscriptions — Codex

- Changed: projected subagent islands subscribe by agent-run ID and keep their adapter mounted across patches. Tool reconciliation ignores subagent detail changes while still detecting subagent identity changes, so description/status patches no longer wake the owning tool entity.
- Evidence: focused tool/store tests passed 29/29, including sibling agent isolation, adapter update without remount, and stable owning-tool identity; the existing subagent activity/renderer suite passed 27/27; typecheck, lint, and boundaries passed.
- Remaining: WS-04..WS-06.
- Blockers: none.
- Next action: introduce a stable message shell/structure projection so content deltas no longer rerender the owning row or action toolbar.

### 2026-07-16 — WS-04 row-shell subscriptions — Codex

- Changed: projected rows now subscribe to a stable message-structure snapshot rather than the full message. The structure changes for block/tool membership, visibility transitions, interrupt/duration metadata, and user content, but not for same-shape assistant deltas. Copy actions resolve the latest full snapshot at click time; the now-unused whole-message React hook was removed.
- Evidence: focused store/message/content/tool tests passed 49/49. The row-shell regression proves a block delta updates only its Markdown island and does not rerun action predicates, while block addition republishes the shell; copy receives the latest full message. Typecheck, lint, and boundaries passed.
- Remaining: WS-05..WS-06.
- Blockers: none.
- Next action: prove ResizeObserver-driven row remeasurement for subscribed growth, then run the main-window and pop-out manual checks.

### 2026-07-16 — WS-05 deterministic remeasurement gate — Codex

- Changed: added a controlled ResizeObserver regression that grows one subscribed Markdown block from 120px to 240px and proves only its virtual-row measurement changes, moving the next row to 240px and total height to 360px.
- Evidence: `tests/pivi-react/MessageList.test.tsx` passed 10/10 without React act warnings.
- Remaining: build/deploy/reload and manual main-window plus pop-out streaming checks.
- Blockers: none.
- Next action: commit the deterministic gate, then run the live Obsidian validation with synthetic content only.

### 2026-07-16 — Synthetic-tab safety correction — Codex

- Changed: the development 100KB Markdown workload now creates a disposable, session-free tab inside the mounted view, runs through that tab's real projection/Markdown adapter, restores the prior active tab, removes the synthetic tab, and wraps the whole lifecycle in persistence suspension.
- Evidence: the imperative adapter suite passed 23/23, including direct cleanup/restoration and handle-level no-persistence regressions; typecheck, lint, and boundaries passed.
- Remaining: rebuild the development plugin and run WS-05/WS-06 only through the corrected synthetic path.
- Blockers: none.
- Next action: commit this safety correction before any real-Obsidian workload.

### 2026-07-16 — Development bundle deployment correction — Codex

- Changed: bounded the dynamic-node-import fallback scans and replaced unbounded generic-loader regexes with literal-indexed rewrites, preventing catastrophic backtracking on the 25.3MB unminified development bundle.
- Evidence: build compatibility tests passed 3/3; typecheck, lint, and boundaries passed; the one-off development build completed in 0.8s, rewrote node imports, deployed all three artifacts, matched the deployed checksum, retained debug commands, and contained no dynamic `node:` imports.
- Remaining: record the live validation results, restore the production artifact, and complete WS-05/WS-06.
- Blockers: none.
- Next action: commit the build fix, then finish trace comparison and production restoration.

### 2026-07-16 — WS-05/WS-06 live validation and acceptance correction — Codex

- Changed: completed the main-window and pop-out synthetic 100KB workload through disposable, session-free tabs; verified row growth/anchoring without overlap or clipping; restored the production artifact; and corrected WS-06 so deterministic component render counts prove subscription isolation while Spec 001 traces prove runtime non-regression.
- Evidence: `2026-07-15T20-11-05-930Z-spec-003-granular-main.json` recorded 67 projection commits, 65 synthetic-block Markdown renders / 450.8 ms, max 2 workload rows / 3,463 DOM nodes, one workload long task (256 ms), and max 18.7 ms event-to-paint. `2026-07-15T20-12-38-380Z-spec-003-granular-popout.json` recorded the same 67/65 cadence, 431.3 ms synthetic Markdown time, max 2 workload rows / 3,463 DOM nodes, one workload long task (261 ms), and max 69.8 ms event-to-paint. Workload bounds select the interval from the first synthetic-message commit through the final synthetic-block render; cleanup restoration raised the whole-trace maxima to 25/20 rows and added one long task in each trace. Both identify only their expected owner window. Live DOM inspection found no overlap, scroll-away remained 240 px from the end, synthetic markers and the temporary pop-out were removed, and `obsidian dev:errors` was clean after production restoration.
- Problem recorded: the original criterion required reduced trace commits/renders, but the recorder has no React component-commit signal. This spec deliberately retains whole-message ingestion, so projection commits remain 67; the single affected Markdown block also correctly renders 65 times. Restoration of the pre-existing active transcript added 41 unrelated Markdown renders in main and 30 in pop-out, so workload render evidence is filtered by the canonical synthetic block ID rather than misreported as a scenario regression.
- Remaining: synchronize durable guidance, run the full repository gate, record the completion summary, and archive the spec.
- Blockers: none after adopting the corrected evidence boundary.
- Next action: update docs/11 and the owning `AGENTS.md` contracts, then run the full completion gate.

### 2026-07-16 — Completion gate and archive — Codex

- Changed: synchronized the adopted structure/entity subscription contracts into durable guidance, completed the repository and production-runtime gates, and archived spec 003.
- Evidence: `npm run test:coverage -- --runInBand` passed 232 suites / 1,753 tests with global statements/branches/functions/lines at 67.69%/56.76%/64.59%/69.14%; `npm run typecheck`, `npm run lint`, and `npm run check:boundaries` passed. `npm run build` deployed the production bundle; `npm run check:bundle-size` reported 3,006,322 bytes (2.87 MB, 2.13 MB below the cap); source and deployed artifacts matched; production debug markers were absent. Reloading Pivi produced no captured Obsidian errors, no synthetic message markers remained, and the temporary performance scenario file was absent. `npm run check:specs` passed after archival.
- Remaining: none for spec 003.
- Blockers: none.
- Next action: activate spec 004 and execute its workstreams.

## Completion summary

Spec 003 moved virtualized message rows from whole-message React subscriptions to stable message-structure subscriptions and moved hot interiors onto reconciled block, tool, and Agent-run entities. Keyed reconciliation preserves unchanged identities, publishes changed/removal keys only, and keeps imperative Markdown, rich-tool, and stored-subagent adapters mounted across in-place updates. Copy resolves the latest full message at invocation time, and ResizeObserver-driven growth still remeasures only the owning row.

Two evidence-boundary deviations were recorded rather than hidden. First, the activation audit found that the store did not yet reconcile entities, so WS-00 added that correctness prerequisite. Second, the original trace-reduction criterion could not measure sibling React renders and conflicted with the intentionally unchanged whole-message ingestion cadence. The adopted criterion uses deterministic component render-count tests as direct isolation proof and main/pop-out Spec 001 traces as runtime non-regression evidence; it makes no unsupported speedup claim.

Verification covered entity identity/removal behavior, sibling block/tool/Agent isolation, row-shell isolation, latest-message actions, adapter update-without-remount behavior, virtual-row remeasurement, the full 232-suite coverage run, type/lint/boundary checks, production build and bundle budget, deployed artifact identity, development-marker absence, main/pop-out synthetic runtime traces, production reload, cleanup, and zero captured Obsidian errors.

Durable conclusions were synchronized into `docs/11-chat-ui-evolution.md`, root `AGENTS.md`, `packages/pivi-react/AGENTS.md`, and `src/ui/chat/rendering/AGENTS.md`. Synthetic workload safety remains documented in `src/app/AGENTS.md` from its implementation commit.
