---
id: "003"
title: "Granular block, tool, and Agent-run subscriptions in message interiors"
status: Active
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

- [ ] `TextBlockView` (or a thin wrapper) subscribes through `useChatProjectionBlock` for its own block ID; a streaming delta does not re-render sibling blocks or tool views. Verified by a deterministic Jest render-count test modeled on `AssistantContentView.test.tsx` mount-count assertions.
- [ ] `ToolCallView` subscribes through `useChatProjectionTool`; a tool status flip re-renders only that tool shell. Same verification style.
- [ ] The subagent slot subscribes through `useChatProjectionAgentRun`; subagent status/description updates do not re-render the owning message row. The imperative `SubagentRenderer`/`AsyncSubagentRenderer` adapters keep receiving updates via their existing `update` path.
- [ ] The message row keeps subscribing only to shell/ordering metadata (docs/11 `MessageRow` role); block additions/removals still re-render the row.
- [ ] Row remeasure still happens when a subscribed block grows (TanStack `measureElement` reruns), verified by a test and manual streaming in Obsidian (no overlap/clipping, anchored follow keeps working).
- [ ] Spec 001 traces show reduced commits/rerenders per streamed token on the 100KB-Markdown and 5K-message scenarios (before/after recorded).

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

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-00 | Reconcile block/tool/agent entity snapshots on whole-message upsert; preserve unchanged identities, publish changed entities only, and notify removals | Codex | Done | None | Extended `tests/pivi-react/chatUiStore.test.tsx` + typecheck/lint/boundaries |
| WS-01 | Block-level subscription: wrapper component around `TextBlockView`/`ThinkingBlockView` using `useChatProjectionBlock`; render-count regression test | Codex | Done | WS-00 | `npm run test -- tests/pivi-react/AssistantContentView.test.tsx` (extended) |
| WS-02 | Tool-level subscription in `ToolCallView` via `useChatProjectionTool`; status-flip render isolation test | Codex | Done | WS-00 | `npm run test -- tests/pivi-react/ToolCallView.test.tsx` (extended) |
| WS-03 | Agent-run subscription for `ImperativeSubagentSlot` via `useChatProjectionAgentRun`; keep adapter `update` contract intact | Codex | Done | WS-00 | Extended jsdom test + projection store tests |
| WS-04 | Row-shell narrowing: `ProjectedMessageRow`/`MessageView` subscribe to shell metadata; block list identity churn audit | Codex | Done | WS-01..WS-03 | `tests/pivi-react/MessageList.test.tsx` mounted-row invariants stay green |
| WS-05 | Remeasure correctness: growing subscribed block remeasures its row; manual streaming check in main + pop-out windows | Codex | In progress | WS-01 | Jest + manual per root AGENTS.md deploy flow (`npm run build && obsidian reload`) |
| WS-06 | Before/after traces with spec 001 harness | Codex | Pending | WS-01..WS-05, spec 001 | Recorded traces in Progress and handoff |

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

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
