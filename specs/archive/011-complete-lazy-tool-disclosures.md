---
id: "011"
title: "Complete lazy tool disclosures"
status: Completed
created: 2026-07-16
updated: 2026-07-16
coordinator: "Codex"
---

# 011 — Complete lazy tool disclosures

## Context

Pivi virtualizes transcript message rows and remeasures dynamic content, but expanded tool bodies still impose presentation-only line, field, path, task, query, character, Markdown, and diff caps. Stored React tools already mount content on first expansion, while synchronous subagents and their imperative nested tools still build hidden content eagerly. At the transcript end, TanStack Virtual's end anchoring also moves a disclosure header when its row grows. This work makes expanded content complete, lazy, height-bounded, and visually anchored without weakening message virtualization or session/tool boundaries.

## Goal and success criteria

- [x] Collapsed headers remain compact, while every expanded body shows all data already present in its snapshot without UI-authored omission markers.
- [x] Provider/tool source truncation remains explicit and no expansion re-executes a tool or reads a new external source.
- [x] React tools, synchronous and asynchronous subagents, and imperative nested tools defer expensive body rendering until expansion and rebuild from the latest dirty snapshot.
- [x] Each top-level tool, steps group, or subagent uses one scroll owner and is capped at one third of its actual messages viewport height in main and pop-out windows.
- [x] Pointer and keyboard disclosure activation preserve the header's viewport position within one pixel through virtual-row remeasurement and asynchronous body rendering, unless the user starts another scroll/navigation gesture.
- [x] Reaching an internal scroll end preserves the expanded state and chains continued scrolling to the transcript, progressively clipping the card instead of collapsing it abruptly.
- [x] Existing 5K transcript row bounds, history anchoring, append following, accessibility, and owner-realm cleanup remain green.

## Scope and non-goals

In scope:

- Expanded tool/subagent result rendering, lazy imperative adapters, disclosure height/scroll ownership, and virtualized transcript disclosure anchoring.
- Regression tests, performance-node budgets, durable handbook/guidance updates, production deployment, and live Obsidian inspection.

Not in scope:

- Changing tool execution limits, session JSONL, `ToolCallInfo`/`SubagentInfo` persistence, or provider output contracts.
- Expanding collapsed header summaries onto multiple lines, re-running tools, or recovering bytes absent from the stored snapshot.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-16 | Complete display applies to expanded bodies only; collapsed titles retain one-line ellipsis. | Transcript density remains bounded while disclosure means complete inspection. | WS-01, WS-02 |
| 2026-07-16 | Expansion only renders snapshot data and preserves upstream truncation signals. | UI presentation must not cross execution, filesystem, or persistence boundaries. | WS-02 |
| 2026-07-16 | The top-level disclosure owns the sole one-third-height scroll area; nested disclosures reuse it. | Avoid nested scroll traps while keeping every opened card bounded. | WS-01 |
| 2026-07-16 | `MessageList` owns temporary disclosure anchoring and shares a narrow callback with imperative adapters. | The virtualizer remains the single owner of transcript scroll behavior. | WS-01 |
| 2026-07-16 | Frequent disclosure toggles are immediate and do not animate height or position. | Direct response avoids measurement churn and pointer displacement. | WS-01 |
| 2026-07-16 | Internal scroll completion never changes disclosure state; native scroll chaining hands continued movement to the transcript. | The card should shrink from view with its parent viewport, reaching title height before leaving, rather than disappearing through an automatic click. | WS-01 |
| 2026-07-16 | Top-level disclosure bodies own the internal scrollbar; nested steps inside a subagent use `overflow: hidden` as the sticky clip containing block; tool titles stack flush at `top: 0` without measured offset variables. | Prevent child titles from crossing parent titles in geometry and eliminate header-stack padding gaps. | WS-01 |
| 2026-07-16 | Top-level card headers are layout-fixed at the card top (`overflow: hidden` wrappers); nested stickies live inside the body scrollport with measured `--pivi-tool-step-group-sticky-top`. | Prevent subagent headers detaching from their card frame and enable Tool to stick under Steps in three-level cards. | WS-01 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Viewport-relative disclosure caps and virtual-row header anchoring | Codex coordinator | Done | None | Focused MessageList/CSS/interaction tests plus live main-window probe |
| WS-02 | Complete expanded renderers and lazy sync-subagent/nested-tool bodies | `/root/complete_lazy_renderers` | Done | WS-01 callback contract | Focused renderer/subagent suites and 10K-line DOM budget |
| WS-03 | Integration, durable docs, full gates, build/reload, and closeout | Codex coordinator | Done | WS-01, WS-02 | Full Jest, typecheck, lint, boundaries/spec/i18n, production/live evidence |

## Verification

```bash
npm run test -- --runInBand tests/pivi-react/MessageList.test.tsx tests/pivi-react/ToolCallView.test.tsx
npm run test -- --runInBand tests/unit/features/chat/subagentActivity.test.ts tests/pivi-react/ImperativeToolCallRenderer.test.ts
npm run test -- --runInBand tests/unit/ui/toolStepGroupStyles.test.ts tests/unit/ui/subagentShellStyles.test.ts
npm run typecheck
npm run lint -- --quiet
npm run check:boundaries
npm run check:specs
npm run test -- --runInBand
npm run build
obsidian reload
obsidian dev:errors
```

Live acceptance uses the active sidebar's measured `.pivi-messages.clientHeight`: every top-level expanded content area's client height must remain at or below one third, long content must scroll internally, and the activated header top must drift by no more than one pixel after body settlement.

## Documentation sync

- Numbered developer docs: `docs/06-subagents-streaming-and-rendering.md`, `docs/11-chat-ui-evolution.md`.
- Nearest local guidance: `src/ui/chat/rendering/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`.
- Parent/package guidance: `packages/pivi-react/AGENTS.md`, `src/ui/chat/AGENTS.md` if the adapter context changes its map.
- Root guidance and roadmap: `AGENTS.md` quality snapshot and `docs/10-roadmap-release-and-maintenance.md` verification record when counts/artifact sizes change.

## Progress and handoff

### 2026-07-16 — Codex coordinator — coordination

- Changed: activated the decision-complete spec and claimed viewport sizing/anchoring plus final integration.
- Evidence: repository inspection confirmed dynamic virtual-row measurement, end-anchor scroll adjustment, eager sync-subagent/nested-tool paths, and presentation-only omission sites.
- Remaining: implement all workstreams and collect focused/full/live evidence.
- Blockers: none.
- Next action: define the disclosure anchor callback and viewport-relative height contract, then implement complete lazy renderers against it.

### 2026-07-16 — Codex coordinator — focused implementation evidence

- Changed: added owner-window viewport measurement, temporary virtual-row disclosure anchoring, shared React/imperative callbacks, one-scroll-owner CSS, complete snapshot renderers, and lazy dirty-snapshot rebuilds for stored subagents and nested tools.
- Evidence: 9 focused suites / 99 tests passed, including 600/739/900 px height behavior, pointer and keyboard cancellation semantics, 10K-line constant-node rendering, complete diff/Markdown/source-truncation coverage, and collapsed-update regression cases; source and test typechecks plus lint passed.
- Remaining: full Jest, repository gates, production build/reload, live sidebar measurement, and documentation quality snapshot refresh.
- Blockers: none.
- Next action: run full verification and collect live Obsidian evidence.

### 2026-07-16 — Codex coordinator — completion evidence

- Changed: synchronized the numbered handbook, package/local guidance, root quality snapshot, roadmap verification record, and locale catalogs; archived the completed spec.
- Evidence: 246 suites / 1,898 tests passed; typecheck, lint, architecture, package README, i18n dead-key, specs, bundle-size, bundle-analysis, and production-build gates passed. The final `main.js` is 3,049,008 bytes. After production deploy/reload, the 739 px live messages viewport published a 246.33 px cap. Baldwin's 244 px expanded subagent wrapper held 1,177 px of content: scrolling it by 150 px left the agent title at the same screen Y position while the List row moved underneath the title's opaque z-index layer. In the live top-level `2 steps / Search` example, scrolling 160 px held `2 steps` at Y=174 px and stacked Search at Y=192.398 px, exactly the group title's bottom edge with 0 px gap while Search results passed underneath. Scrolling that 246.33 px group to its 569 px internal maximum preserved its expanded state; continued transcript movement reduced its visible height through 218, 178, 138, 98, 58, 38, 18, and 0 px without a disclosure-state mutation. Nested disclosures created no competing scroll owner, no UI truncation marker appeared, and `obsidian dev:errors` reported no captured errors.
- Remaining: none.
- Blockers: none.
- Next action: preserve these disclosure, virtualization, and one-scroll-owner invariants in subsequent UI work.

## Completion summary

Expanded tool and subagent disclosures now show every byte already present in their snapshot without presentation caps, while upstream truncation remains explicit. Stored subagents and nested tools defer body construction until expansion and rebuild from their latest dirty snapshot. `MessageList` measures its owner-realm viewport, shares a one-third height cap, and temporarily compensates transcript scroll so pointer or keyboard activation leaves the disclosure title in place. Internal scroll completion preserves the disclosure and chains continued movement to the transcript, allowing the card to leave the viewport progressively. Focused, full, bundle, production, and live Obsidian verification all passed.
