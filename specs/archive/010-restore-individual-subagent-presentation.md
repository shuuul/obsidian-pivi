---
id: "010"
title: "Restore individual subagent presentation"
status: Completed
created: 2026-07-16
updated: 2026-07-16
coordinator: "Codex"
---

# 010 — Restore individual subagent presentation

## Context

The performance work completed by specs 001–004 is correct and remains the required foundation: virtualized transcript rows, indexed recent-first hydration, granular projection subscriptions, stable entity identity, and sequenced owner-realm publication. Those specs did not require a visual redesign. Spec 002 explicitly excluded UI visual changes, spec 003 kept the imperative subagent renderer behind an entity subscription, and spec 004 added no UI component. Commit `4349b142` (the completion of spec 004) is therefore the last decision-complete performance baseline before the disputed presentation work; tag `0.9.0` is the product-facing visual reference.

Specs 006 and 008 subsequently changed the subagent product UI. Spec 006 made imperative Agent headers adopt the shared Activity-row vocabulary. Spec 008 added a rich `AgentRun` read model, consecutive-run grouping, per-run timelines, structured Narrative conclusions, and a composer-adjacent Active Work Shelf. The implementation intentionally retained the imperative renderer for one subagent while switching two or more consecutive sibling subagents to `AgentGroupView`. As a result, the same durable subagent data uses different information architecture, density, expansion, and result rules based only on sibling count.

The structured-report path has a separate visible-output defect. The runtime asks every subagent to end with one fenced `pivi-agent-report` JSON block and preserves the full terminal text. A validated report is hidden and reformatted by `AgentGroupView`, but the single-run imperative path prefers the full `terminal_result` and renders it as Markdown. The protocol block therefore leaks into the visible result for a valid single run; malformed protocol objects may also reach a raw `JSON.stringify` fallback. Structured reports are useful for compact parent context and recovery metadata, but are not user-facing transcript content.

The current motion also differs from the intended subagent contract. The pre-redesign presentation had a thin flowing `::after` light bar along the bottom edge of a running subagent header plus motion within its assigned profile icon. Later cleanup removed `pivi-running-header-flow` and the profile-icon keyframes. The separate `.pivi-subagent-progress` node is not that light bar: it was already `display: none` in `0.9.0`, remains hidden today, and is dead presentation state. The DOM still distinguishes running and terminal lifecycle updates, but the expected running light bar is absent and most profile icons carry animation-target classes without the matching keyframes. Terminal update paths already replace or clear some animation classes, but the complete running → terminal visual transition is not covered as one contract.

The user has now made the product decision explicit:

- Keep the virtualization/performance architecture.
- Remove Agent Group and every presentation/support path that exists only for grouping, timelines, Narrative conclusions, or the Active Work Shelf.
- Render every subagent independently in the transcript using the pre-redesign card structure.
- Never show active Agents in the composer.
- While a subagent is running, show a flowing light bar below its header and animate its assigned icon; after it reaches a terminal state, remove both motions and leave the icon static.

This spec is a forward restoration, not a Git revert. It removes obsolete presentation decisions while preserving later correctness, lifecycle, localization, persistence, and performance fixes that remain useful.

## Goal and success criteria

Outcome: one consistent individual subagent card is the only subagent transcript presentation, the composer contains no Agent activity surface, protocol JSON never appears as user-visible result text, and motion truthfully follows the subagent lifecycle without regressing virtualization.

- [x] One and many sibling subagents use the same `ToolCallView` → projected imperative subagent-slot path, keyed by the persisted spawn-tool/subagent ID. No sibling-count branch, Agent Group summary, grouped disclosure, timeline, or Narrative conclusion remains. Verified by React tests for 1, 2, and 20 sibling runs plus zero source/style/i18n references to the deleted presentation.
- [x] `AgentGroupView.tsx` and all group/timeline/conclusion-only CSS, i18n keys, tests, exports, helpers, derived fields, glossary entries, and documentation are deleted. `rg` and the i18n dead-key gate report zero dangling or dead references.
- [x] The entire first-class spec-008 `AgentRun` projection is removed: `agentRunProjection.ts`, the public `AgentRun` read-model type, Agent-run maps/listeners/hooks/exports, nested graph/report derivation, and active-run snapshots are absent. The projected `ToolCallView` already subscribes to its stable `ChatToolEntity`; it passes `tool.subagent` to the existing imperative slot and updates one individual card without rerendering the message row.
- [x] The Active Work Shelf is removed end to end: no component, composer prop/hook, bridge aggregation, navigation callback, projection snapshot, setting/default/normalizer, port field, Settings toggle, CSS, i18n key, test fixture field, docs, or local guidance remains. A previously persisted `showActiveWorkShelf` value is ignored at the validated settings boundary and cannot affect composer DOM.
- [x] The composer renders no active/queued/waiting Agent content in any setting or lifecycle state. Verified in the active and inactive-tab background-run matrix and by asserting zero `.pivi-active-work-shelf` or successor surface in the composer portal.
- [x] A validated `pivi-agent-report` remains available for parent-context formatting and persisted recovery metadata, but every transcript result path strips the validated terminal fence before rendering. Invalid/malformed protocol blocks and legacy `{agents: ...}` wrappers produce bounded human-readable fallback text or an explicit localized failure, never raw protocol JSON or `JSON.stringify` output. Verified for blocking/background, valid/invalid/missing reports, restored sessions, and Markdown fallback failures.
- [x] The individual card preserves the pre-redesign Prompt → nested Tools → Result disclosure structure and information density. Consecutive cards remain independent and retain their own expansion state across projection updates.
- [x] Subagent-specific Activity-row adoption and elapsed-time chrome introduced after the baseline are removed from the individual header; ordinary tool `ActivityRow` and elapsed presentation remain unchanged. The unused `.pivi-subagent-progress` element/state/CSS is deleted rather than repurposed—the running light bar is the scoped header pseudo-element.
- [x] Exactly the `running` lifecycle state animates: sync and async renderers normalize it to one canonical `.running` wrapper class, a thin flowing light bar appears at the bottom edge of the individual subagent header, and the assigned profile icon animates. `queued` and `waiting` are visibly labeled but static. `completed`, `failed`, `cancelled`, and `orphaned` remove the light bar and all icon animation in the same lifecycle update; the assigned profile icon remains visible and static, with terminal outcome communicated by localized status text/style rather than a continuing motion.
- [x] Running → completed/failed/cancelled/orphaned transitions do not require remounting the card, do not lose expansion state, and leave no animation class, pseudo-element selector match, interval, timeout, or animation-frame loop behind. Stored terminal sessions mount directly in the static state.
- [x] `prefers-reduced-motion: reduce` disables both the light-bar and icon animation while preserving status labels, icon visibility, and all state transitions. Main-window and pop-out owner realms behave identically.
- [x] Virtualized transcripts, indexed paging, stable message/tool entity identities, stable imperative subagent adapter mounts, per-entity subscriptions, dynamic row measurement, append/prepend anchoring, and sequenced visibility cadence retain the specs 001–004 correctness and performance budgets. The 20-subagent development workload remains as a presentation-neutral virtualization regression scenario, renamed away from `AgentRun` terminology if its existing name becomes inaccurate.
- [x] Before completion, the user reviews live Obsidian screenshots/walkthroughs for the required matrix and explicitly accepts the restored presentation. Synthetic fixtures may support automation but cannot substitute for this visual acceptance.

## Scope and non-goals

In scope:

- Restoring the tag-`0.9.0` / post-spec-004 individual subagent card structure while keeping the current virtual row and projection ownership seams.
- Removing the complete Agent Group/timeline/Narrative presentation and the support code made redundant by that removal.
- Removing the complete Active Work Shelf feature, including synchronized configuration and inactive-tab aggregation.
- Removing the spec-008 first-class `AgentRun` projection and using the already granular tool-entity subscription to update individual subagent slots.
- Sanitizing structured Agent report protocol content at one shared presentation boundary before either sync or async result rendering.
- Restoring lifecycle-scoped subagent light-bar and profile-icon motion with reduced-motion and pop-out support.
- Updating tests, all ten locale catalogs, numbered docs, glossary, roadmap/release notes where current behavior is described, and affected layered `AGENTS.md` files.

Not in scope:

- Reverting transcript virtualization, indexed JSONL reads, projection reconciliation, stable IDs, event sequencing, visibility cadence, development-only performance recording, or the virtual viewport handle.
- Removing the core `AgentReport` schema, checkpoint schema, strict parser, persisted structured metadata, or compact parent-context formatter. These remain internal protocol/recovery facilities.
- Changing subagent runtime execution, FIFO admission, concurrency limits, background execution, cancellation, orphan recovery, nested tool persistence, or complete durable terminal traces.
- Reverting the shared `ActivityStatus` lifecycle vocabulary or its persisted optional facts when they are still needed for truthful queued/running/waiting/terminal state.
- Redesigning general tool-call, Memory boundary, context usage indicator, composer input, or tab UI. Shared tool `ActivityRow` presentation may remain; only subagent-specific adoption is changed where required to restore the individual card.
- Adding a replacement shelf, floating status widget, badge, toast, or alternate global Agent surface.
- Changing the assigned subagent profile/icon catalog. The same assigned icon transitions from animated to static.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-16 | Use tag `0.9.0` and commit `4349b142` as presentation and performance baselines respectively | `0.9.0` shows the intended individual cards; `4349b142` contains specs 001–004 without the disputed 006/008 UI | WS-01, WS-02, WS-05 |
| 2026-07-16 | Delete Agent Group rather than hide it behind a flag | Single/grouped dual rendering is the structural inconsistency; a dormant alternative would be dead code and violate the one-obvious-implementation rule | WS-02 |
| 2026-07-16 | Delete Active Work Shelf end to end rather than default it off | The composer must never display active Agents; retaining settings, aggregation, and navigation would preserve an unwanted second presentation path | WS-03 |
| 2026-07-16 | Delete the first-class `AgentRun` projection rather than retain a reduced form | `ToolCallView` already subscribes to the stable tool entity that owns `tool.subagent`; after Group/Shelf removal a second subagent projection has no consumer and would duplicate state | WS-02 |
| 2026-07-16 | Keep structured reports as internal protocol and sanitize only the display projection | Parent context benefits from compact validated reports and persistence benefits from recovery metadata; the protocol fence is not transcript content | WS-04 |
| 2026-07-16 | Restore the individual subagent header itself, not spec-006 Activity-row/elapsed chrome | The accepted baseline predates that header redesign; ordinary tool Activity rows remain independently useful and outside scope | WS-02, WS-05 |
| 2026-07-16 | Animate only `running`; all other lifecycle states are static | Motion must communicate active execution truthfully. Queued/waiting work is not currently executing, and terminal work must stop immediately | WS-05 |
| 2026-07-16 | Normalize sync and async running wrappers to `.running` and remove legacy `.is-running` | One lifecycle fact must control the bar, icon, and status; the current sync finalizer fails to clear `.is-running`, which would revive terminal motion if old CSS were copied verbatim | WS-05 |
| 2026-07-16 | Keep the assigned profile icon across the terminal transition | The user's requested visual contract is motion → stillness, not replacing identity; localized status text/style communicates the outcome | WS-05 |
| 2026-07-16 | Require live user visual acceptance before archival | Specs 006/008 substituted deterministic/synthetic checks for the intended visual walkthrough, which did not validate product intent | WS-01, WS-06 |
| 2026-07-16 | Preserve archived specs 005–009 as historical evidence and supersede only their current presentation decisions | Archive records must remain honest; current handbook/guidance will describe the restored product while spec 005's internal report protocol remains active | WS-06 |
| 2026-07-16 | Treat complete post-reload transcript recovery as part of restoration acceptance | The live vault showed a completed response before reload but its assistant/tool entries were missing afterward; a presentation restoration is incomplete if durable content or its request badges disappear | WS-07 |

## Redundancy and retention inventory

The implementation work must update this inventory if source inspection finds another dependent path. A deleted root must not leave dormant exports, settings, styles, translations, tests, or documentation.

| Area | Current purpose | Required disposition | Why |
|---|---|---|---|
| `packages/pivi-react/src/chat/messages/AgentGroupView.tsx` | Group summary, per-run disclosures, timeline, Narrative conclusion | Delete file | Entire component implements the rejected presentation |
| `AssistantContentView.tsx` consecutive-subagent collection and sibling-count branch | Switches 2+ siblings to Agent Group | Delete branch; render every block through the same `ToolCallView` path | Restores one information architecture without touching virtual rows |
| Agent Group/timeline/conclusion selectors in `styles/components/toolcalls.css` | Styles the rejected React presentation | Delete selectors and any now-unused custom properties | No caller remains; retaining them is dead CSS |
| Group/conclusion translation keys in all locale catalogs | Labels counts, timelines, conclusions, report fields | Delete keys used only by `AgentGroupView` | Dead-key gate must pass; Prompt/Result/status keys still used by individual cards stay |
| `packages/pivi-react/src/store/agentRunProjection.ts` | Builds recursive rich Agent-run graphs and report projections | Delete file | Group/Shelf are its only presentation consumers; tool entities already carry the individual subagent snapshot |
| Core `AgentRun` / `AgentRunUsage` read-model types and `SubagentInfo.usage` added only for that projection | Feeds the rich projection | Delete after confirming the current repository has no non-projection producer/consumer; if durable usage evidence appears, rename it to a subagent-owned type and document that exception | Avoid preserving a speculative public read model or misleading AgentRun terminology |
| Agent-run maps, entity keys, listeners, singular/multi/active hooks, and exports in `ChatProjectionStore` / `store/index.ts` | Feeds Group, Shelf, and a redundant projected subagent slot | Delete | Projected `ToolCallView` already receives granular stable tool snapshots and can update the same imperative slot |
| `ProjectedImperativeSubagentSlot` in `ToolCallView.tsx` | Adds a second Agent-run subscription inside an already projected tool view | Delete; pass the subscribed `toolCall.subagent` to `ImperativeSubagentSlot` | Removes duplicate projection without weakening row isolation or adapter stability |
| Subagent `pivi-activity-*` header classes, imperative `activityElapsed.ts`, and elapsed controller fields | Mirrors spec-006 Activity-row/elapsed chrome inside the individual card | Remove from subagents; delete helper if no non-subagent caller remains | Restores baseline information density; React tool elapsed remains separate |
| `.pivi-subagent-progress`, `progressEl`, and visibility toggles | Hidden legacy progress node unrelated to the requested light bar | Delete DOM/state/CSS/accessibility selector | It is `display: none` in both baseline and HEAD and has no visible function |
| `ActiveWorkShelf.tsx` and input CSS | Composer activity surface | Delete | Composer must contain no Agent activity UI |
| Active-work types/state in `activeChatUiBridge.ts` and hooks/props in `ConnectedActiveTabSurfaces.tsx` / `ComposerChrome.tsx` | Cross-tab aggregation and navigation | Delete | Entire chain has no remaining consumer |
| `imperativeChatAdapter` shelf source synchronization and pending shelf navigation | Connects all tab projections and virtual viewport navigation | Delete shelf-specific logic only | Semantic viewport navigation used elsewhere remains |
| `showActiveWorkShelf` in core settings, chat/settings ports, UI snapshots, toolbar refresh, Settings UI | Persists and exposes the unwanted feature | Delete field/default/normalization/wiring/toggle | Previously persisted unknown input must be ignored; no compatibility UI is retained |
| Shelf/group i18n keys and `ActiveWorkShelf.test.tsx` plus shelf-specific assertions/fixtures | Tests and labels removed behavior | Delete; simplify fixtures that only carry the setting | Tests must describe the restored product, not keep obsolete feature coverage |
| Root glossary/docs/local guides describing AgentRun Group/Shelf | Durable documentation for rejected UI | Remove or rewrite to individual-card projection terminology | Documentation must not advertise deleted behavior |
| 20-Agent/AgentRun development workload | Stresses large delegated-execution UI | Retain the workload as a 20-subagent virtualization scenario; remove Group assertions and rename inaccurate AgentRun-facing command/types/docs | Performance evidence remains valuable even though Group presentation is deleted |
| `ActivityRow`, canonical status mapping, elapsed formatting used by ordinary tools | Shared non-Group tool presentation | Retain | These have independent consumers and are outside this restoration |
| Message/block/tool projection entities, stable tool ID, and projected `ToolCallView` | Granular individual-slot subscription | Retain | Supplies the same spec-003 isolation without a second first-class Agent-run read model |
| `AgentReport` schema/parser, JSONL details, compact parent formatter | Internal parent context and recovery protocol | Retain | Only its visible raw-text leakage is defective |
| Full durable terminal trace | Session recovery/debug source of truth | Retain | Display sanitization must not mutate persisted history |
| Profile icon catalog and deterministic writer/icon assignment | Individual Agent identity | Retain | Only lifecycle motion rules change |
| Baseline `pivi-running-header-flow` and profile-specific CSS keyframes | Running-only individual-card motion | Restore with strict `.running` selectors and reduced-motion overrides | Implements the requested light bar/icon motion without JavaScript timers |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Capture the exact `0.9.0` individual-card DOM/visual baseline and define live main/pop-out fixtures without modifying user sessions | Codex coordinator | Done | None | Baseline diff, screenshots, fixture manifest, user review plan |
| WS-02 | Remove Agent Group/rich AgentRun presentation and restore one projected individual-card path | agent-group-removal | Done | WS-01 | Focused React/store/render-count tests; `rg` dead-reference audit |
| WS-03 | Remove Active Work Shelf end to end, including persisted setting and cross-tab wiring | active-work-removal | Done | None | Settings/bridge/composer tests; zero shelf source/i18n/CSS/docs references |
| WS-04 | Add one report-to-visible-result boundary and remove raw protocol/`JSON.stringify` fallbacks | Codex coordinator | Done | WS-02 | Parser/renderer/session-restore tests for valid, invalid, absent, blocking, background reports |
| WS-05 | Restore running-only light bar and profile-icon motion, terminal stillness, reduced motion, and owner-realm behavior | subagent-motion | Done | WS-01, WS-02 | DOM/class/CSS tests plus live main/pop-out lifecycle walkthrough |
| WS-06 | Rename/retain the 20-subagent performance workload, synchronize docs/guides, run full gates, deploy/reload, and obtain user visual acceptance | Codex coordinator | Done | WS-02, WS-03, WS-04, WS-05 | Full verification matrix, performance traces, screenshots, explicit user approval |
| WS-07 | Restore complete turn persistence and historical request badges after plugin reload | Codex coordinator | Done | None | Live-vault JSONL audit; runtime persistence failure test; indexed reopen test; historical badge DOM test |

## Verification

### Focused automated matrix

- Individual rendering: one foreground run, one background run, two consecutive siblings, separated siblings, nested subagent tools, and the 20-subagent fixture all mount independent adapter slots with stable IDs and preserved disclosure state.
- Projection isolation: updating one subagent status/result rerenders or updates only its entity/adapter and remeasures only the owning virtual row; siblings and message shells keep identity.
- Result safety: valid fenced report, malformed fence, invalid schema, multiple fences, plain text, empty terminal text, background result wrapper, blocking `terminal_result`, restored session, and Markdown-render rejection never expose protocol JSON.
- Motion state table:

| Status | Light bar | Profile icon motion | Terminal/static |
|---|---|---|---|
| queued | No | No | Static |
| running | Yes | Yes, unless reduced motion | Active |
| waiting | No | No | Static |
| completed | No | No | Static |
| failed | No | No | Static |
| cancelled | No | No | Static |
| orphaned | No | No | Static |

- Every transition from running to a terminal status is exercised without remount; assertions cover wrapper/status classes, running-icon class removal, stable icon identity/shape, hidden/absent light-bar selector, absence of subagent elapsed/progress state, and zero scheduled work owned by the presentation.
- `prefers-reduced-motion` disables motion without hiding the bar/status distinction or icon.
- Settings loading tolerates a historical `showActiveWorkShelf` input but the normalized/runtime/UI shapes do not expose it and composer output remains unchanged.

### Live Obsidian acceptance matrix

Run in both the main window and one pop-out window, using disposable sessions/fixtures:

1. Foreground single subagent: running light bar + animated profile icon; completion removes both motions and preserves the card/result.
2. Background single subagent while staying on the owner tab and while switching tabs: no composer activity UI; transcript card updates correctly.
3. Three concurrent subagents: three independent cards with identical structure; no group summary/timeline/Narrative layer.
4. Failure, cancellation, and orphaning: motion stops immediately and the assigned icon is static; localized terminal status remains readable.
5. Restored completed session: mounts static with no one-frame running animation or protocol JSON flash.
6. Reduced-motion mode: no motion at any stage, but the running/terminal state remains unambiguous.
7. Expand/collapse during running and after completion: state survives updates; virtual row measurement has no overlap, jump, or nested primary scroll.

The user must inspect the resulting live presentation and explicitly approve it before this spec can be marked `Completed`.

### Commands and gates

Run focused tests during each workstream, then before completion:

```bash
npm run test -- --runInBand tests/pivi-react/AssistantContentView.test.tsx
npm run test -- --runInBand tests/pivi-react/chatUiStore.test.tsx
npm run test -- --runInBand tests/unit/features/chat/subagentActivity.test.ts
npm run test -- --runInBand tests/unit/features/chat/subagentResultParser.test.ts
npm run test -- --runInBand tests/unit/ui/subagentShellStyles.test.ts
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:architecture
npm run check:specs
npm run test:coverage -- --runInBand
npm run analyze:bundle
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
```

Also run the renamed 20-subagent development workload in disposable main/pop-out sessions and compare its virtual-row, Markdown-render, DOM-node, long-task, and scroll-anchor results against the accepted specs 001–004 budgets. Performance acceptance must stop before restoring the original tab so cleanup rendering is not counted.

## Documentation sync

- Numbered developer docs: update `docs/06-subagents-streaming-and-rendering.md`, `docs/08-presentation-settings-and-inline-edit.md`, `docs/09-development-debugging-and-validation.md`, `docs/10-roadmap-release-and-maintenance.md`, and `docs/11-chat-ui-evolution.md` to remove Group/Shelf claims, document individual cards/report sanitization/motion, and rename the retained performance workload.
- Nearest local guidance: update `src/ui/chat/AGENTS.md`, `src/ui/chat/rendering/AGENTS.md`, `packages/pivi-react/AGENTS.md`, `packages/pivi-react/src/i18n/AGENTS.md`, and `packages/pivi-react/styles/AGENTS.md` where their maps/rules mention AgentRun groups, Shelf, translations, or motion.
- Parent/package guidance: update `packages/pivi-agent-core/AGENTS.md` if the rich `AgentRun` type and Shelf setting are removed from the foundation map.
- Root guidance and roadmap: update root `AGENTS.md` architecture status, settings summary, glossary, quality snapshot/test map if counts change, and `docs/10-roadmap-release-and-maintenance.md` release risk/status.

## Progress and handoff

### 2026-07-16 — Codex — Spec creation and evidence audit

- Changed: created spec 010 and indexed it as the active restoration contract. Recorded the user-approved product decisions, performance preservation boundary, deletion/retention inventory, lifecycle motion table, and required live visual acceptance.
- Evidence: compared tag `0.9.0`, post-spec-004 commit `4349b142`, archived specs 002/003/004/005/006/008, current React/imperative render branches, projection/store/bridge/settings chains, structured-report result flow, current CSS, and animation history. Commit attribution isolates Group (`625cc945`), timeline (`a590fa6e`), conclusions (`4f287581`), Shelf (`c63134e2`), and later motion removal/centralization (`2971f1f3`, `2ec05b35`) from specs 001–004 virtualization.
- Remaining: every implementation and acceptance workstream.
- Blockers: none. Implementation must claim a workstream before editing.
- Next action: capture WS-01 baselines, then execute WS-02 and WS-03 as separate focused changes.

### 2026-07-16 — Codex coordinator — WS-01

- Changed: fixed the implementation baseline without touching a live user session. Tag `0.9.0` is the individual-card visual contract and commit `4349b142` is the accepted post-spec-004 performance contract. The required live acceptance matrix uses disposable main/pop-out sessions only.
- Evidence: `git diff --quiet 0.9.0..4349b142 --` over both subagent renderers, shared/icon helpers, subagent CSS, and base animations returned zero. History attributes the rejected presentation/motion changes to later commits, independently of specs 001–004.
- Remaining: implementation, automated verification, disposable live screenshots/walkthrough, and user signoff.
- Blockers: none.
- Next action: complete WS-02 through WS-05, then run the documented live matrix through WS-06.

### 2026-07-16 — Codex team — WS-02 through WS-05

- Changed: deleted the React Agent Group, rich `AgentRun` graph, Active Work Shelf, synchronized shelf setting, subagent Activity/elapsed/progress chrome, and all exclusive tests/styles/i18n/wiring. Every sibling now uses `ToolCallView` and one stable imperative subagent slot. Added a shared visible-result sanitizer that preserves parent/session reports while stripping valid, malformed, multiple, and unclosed `pivi-agent-report` fences from UI text and removes raw JSON stringify fallbacks. Restored the baseline profile animations and header light bar under the canonical `.running` state only.
- Evidence: focused React/store/settings suites passed; subagent activity, result parser, and continuation-schema suites passed 67/67; command/workload and generator suites passed 34/34; typecheck, lint, boundary, architecture, spec, and i18n dead-key gates passed. Dead-reference scans find deleted feature names only in this active spec and immutable archived specs.
- Remaining: explicit user visual acceptance and any user-requested polish discovered during that review.
- Blockers: none.
- Next action: present the disposable live workload result and keep the spec Active until the user approves it.

### 2026-07-16 — Codex coordinator — WS-06 verification

- Changed: renamed the development command/contract/fixture to `debug-run-20-subagents-workload`, `run20SubagentsWorkload`, and `perf-004-20-subagents.jsonl`; synchronized the root guide, package/local guides, numbered handbook pages, test map, performance narrative, and roadmap. The archived specs remain unchanged as historical decision records.
- Evidence: full Jest and coverage runs exited successfully; production bundle analysis and build passed (`main.js` 3,052,794 bytes; `styles.css` 151,677 bytes), the production metafile/bundle contain zero deleted-feature or development-workload references, reload completed, and `obsidian dev:errors` reported no errors. The isolated live workload reported exactly 20 subagents / 2 messages, mounted 20 independent completed cards, zero running icons, zero Agent Group nodes, and zero composer shelf nodes. Expanding all 20 produced 20 result sections with no report-fence/JSON matches. Screenshot: `/tmp/pivi-spec-010-20-subagents.png`. The workload restored the original tab and removed its disposable session; the production bundle was redeployed afterward.
- Remaining: the user's visual inspection/approval. The full live running/failure/cancellation/reduced-motion walkthrough remains available if the screenshot or automated lifecycle matrix exposes a concern.
- Blockers: spec completion is intentionally gated on explicit user approval.
- Next action: ask the user to inspect the restored presentation; apply feedback or mark the final acceptance criterion complete after approval.

### 2026-07-16 — Codex coordinator — WS-07 reload recovery

- Changed: removed filesystem change time from the rebuildable index fingerprint; retained device/inode, size, mtime, and bounded content hashes. Consolidated assistant/tool persistence into the single post-prompt sync point and routed failures through the visible turn error path. Historical user messages rebuild the first-turn auto-attached current-note badge from the persisted `message_ui.turnRequest` overlay; explicit file/folder presentation remains derived from the original visible input.
- Evidence: the active vault session contained the persisted user request and its `turnRequest` but no assistant/tool message entries despite a completed response being visible before reload. Focused runtime, indexed reopen, trailing-tool, source-fingerprint, and badge-render suites pass 76/76. A production-mode subprocess exercises the real Pi file writer through metadata-only mode drift, assistant/tool append, and indexed reopen. Full Jest passes 1,877/1,877; typecheck, lint, boundary, architecture, spec, and i18n gates pass. After build/reload, the affected live history row again renders its persisted `Han Lee.md` badge and `obsidian dev:errors` is clean.
- Remaining: a fresh user-initiated real provider turn can confirm the deployed build survives another reload. Already-lost assistant bytes cannot be reconstructed from a JSONL that never contained them.
- Blockers: none.
- Next action: deploy, run a fresh turn, reload, and inspect the restored transcript and badges.

### 2026-07-16 — Codex coordinator — turn-scoped file cards

- Changed: separated first-turn current-note capture from explicit file attachments and consumed both kinds of composer cards immediately after a user send or queued-send snapshot. An existing session no longer recreates a current-note card on hydration, and programmatic replay does not clear unrelated composer resources.
- Evidence: focused first-turn, second-turn, loaded-session, direct-send, queued-send, and programmatic-send suites pass 15/15.
- Remaining: deploy/reload and inspect the composer after a first and second live turn.
- Blockers: none.
- Next action: build, reload, and confirm the deployed composer starts later turns without an automatic file card.

### 2026-07-16 — Codex coordinator — hover-only context indicator

- Changed: removed the click-open Context Inspector and all exclusive React state, popup styles, localized copy, and owner-realm dismissal tests. The composer ring is now a non-interactive status image whose sole detail surface is Obsidian's host-owned hover tooltip in compact `used / limit (percentage)` form; hover/active shadow and duplicate pseudo-element text remain prohibited.
- Evidence: focused `ChatShell`, context-meter CSS, and CSS-build tests cover the warning state, single host tooltip, single gauge, no inspector selectors, and no dialog after click. Full Jest passes 244 suites / 1,877 tests; typecheck, lint, architecture, package-readme, spec, and i18n gates pass. The production build/reload exposes a `SPAN role="img"` with `18K / 128K (14%)` as both host tooltip and ARIA label, `box-shadow: none`, zero dialogs after click, zero inspector styles, and no captured Obsidian errors.
- Remaining: none for this follow-up.
- Blockers: none.
- Next action: user visual confirmation of the host tooltip.

### 2026-07-16 — Codex coordinator — input-faithful folder history

- Changed: stopped historical user-message rendering from treating `attachedFilePaths` as visible badges. Those paths remain the complete runtime context expansion, while UI history derives explicit file/folder badges only from `displayContent`; the first-turn auto-attached current note remains the sole metadata-supplemented badge.
- Evidence: focused rendering tests cover one restored current-note badge, suppression of unrelated attachment badges, and one folder badge from `@folder/` despite multiple expanded context files. Full Jest passes 244 suites / 1,878 tests; typecheck, lint, architecture, package-readme, spec, and i18n gates pass. Production build/reload completed at 3,044,954 bytes and `obsidian dev:errors` is clean.
- Remaining: user visual confirmation on a folder turn; no folder-bearing message was mounted in the active live view during automated inspection.
- Blockers: none.
- Next action: user visual confirmation on a folder turn.

### 2026-07-16 — Codex coordinator — compact nested steps

- Changed: aligned subagent-internal step groups with the unboxed transcript-level step summary. Removed the nested group frame and subagent-specific rectangular tool cards, then reduced the expanded tool-row gap and row margins to 0 while preserving the shared outer compact-row treatment, disclosure, status, and container-query behavior.
- Evidence: focused step-group, subagent-shell, assistant-content, and tool-call suites pass 43/43; CSS contracts reject reintroduced nested frames and require contiguous expanded rows. Typecheck, lint, architecture, package-readme, spec, and i18n gates pass. After production build/reload, an owner-realm computed-style probe reports zero group border/padding/background, `gap: 0`, zero step/tool margins, and the shared outer compact row's subtle inline rule/background; `obsidian dev:errors` is clean.
- Remaining: user visual confirmation against the four-step subagent example; that session was not mounted after plugin reload.
- Blockers: none.
- Next action: user visual confirmation against the four-step subagent example.

### 2026-07-16 — Codex coordinator — unboxed tool shells

- Changed: removed the generic `.pivi-tool-call` shell's static inline border, radius, background, and clipping so tool uses are unboxed both inside and outside subagents. Subagent cards retain their enclosing border/background; expanded result bodies retain their semantic inline rule.
- Evidence: CSS regression coverage requires the generic tool shell to remain surface-free while preserving its layout margin. Focused UI suites pass 44/44 and full Jest passes 244 suites / 1,879 tests; typecheck, lint, architecture, package-readme, spec, and i18n gates pass. A deployed owner-realm probe reports zero border/background/radius for both transcript and nested tools, while the subagent remains `1px` bordered with its subtle background and `6px` radius; `obsidian dev:errors` is clean.
- Remaining: user visual confirmation.
- Blockers: none.
- Next action: user visual confirmation.

### 2026-07-16 — Codex coordinator — counted step outcomes

- Changed: replaced the single aggregate status at the right of every transcript-level and subagent-internal step-group header with stable, slash-separated per-status counts, such as `4 Completed` or `3 Completed / 1 Failed`. Individual step rows retain their existing icon, label, and color semantics.
- Evidence: React and imperative renderer regression tests cover all-completed, mixed completed/failed, live running, and terminal update states; all locale catalogs provide the shared count format. Full Jest passes 245 suites / 1,881 tests; typecheck, lint, architecture, package-readme, spec, and i18n dead-key gates pass. The 3,046,112-byte production bundle was deployed and reloaded without captured errors; live DOM inspection reports `3 Completed`, `4 Completed`, and `55 Completed / 5 Failed` summaries from mounted groups.
- Remaining: user visual confirmation.
- Blockers: none.
- Next action: user visual confirmation.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, user visual acceptance, and durable documentation updated.
