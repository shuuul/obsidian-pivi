---
id: "007"
title: "Conservative context envelope, Context Inspector, and checkpoint presentation"
status: Draft
created: 2026-07-15
updated: 2026-07-15
coordinator: "Unassigned"
---

# 007 — Conservative context envelope, Context Inspector, and checkpoint presentation

## Context

`docs/11-chat-ui-evolution.md` (step 7 plus the Context and memory direction section) calls for an estimate-based Context Inspector and checkpoint presentation. Verified current state:

- The usage ring is `UsageMeter` in `packages/pivi-react/src/mount/composer/UsageMeter.tsx`, mounted from `ComposerChrome.tsx`. It shows a single arc for `contextTokens / contextWindow` via `calculateContextUsagePercentage` (`packages/pivi-agent-core/src/foundation/usage.ts`), a warning class above 80%, and an unknown-window warning state. There is no click handler and no expanded inspector anywhere in `packages/pivi-react`.
- Estimation machinery already exists in `packages/pivi-agent-core/src/engine/pi/session/piContextCompaction.ts` (`estimateTextTokens`, `estimateAgentMessage(s)Tokens`, `PiContextTokenIndex`, `estimateActiveContextTokens`, `shouldAutoCompact`), but there is no envelope decomposition (system / recent turns / selected context / tool and Agent results / checkpoints / reserved output / compaction reserve / safety margin) and no approximation-marker convention in usage strings.
- Checkpoint presentation depends on spec 005's `Checkpoint` schema; the Memory chip shell lands in spec 006. This spec fills the chip's expansion and the ring's inspector.
- Provider usage remains authoritative when present (docs/11 rule); `UsageInfo` is built from persisted assistant usage in `PiSessionStore.getUsage()` / `buildUsageInfo()`.

## Goal and success criteria

Outcome: a conservative, clearly-estimated context envelope that drives compaction headroom, an expandable Context Inspector on the existing ring, and an expandable checkpoint boundary, all without false precision or new primary scroll containers.

- [ ] A core envelope calculator implements `usable input = context window - reserved output - compaction reserve - safety margin` with conservative model-independent defaults, and decomposes estimated categories (system, recent conversation, selected context, tool and Agent results, checkpoints, reserved output, compaction reserve, safety margin). Provider-reported totals override estimates when present. Verified by unit tests with fixed fixtures.
- [ ] `shouldAutoCompact` consumes the envelope so compaction triggers before the provider limit with the reserved headroom; existing compaction trigger tests updated, no regression in trigger behavior for sessions that previously compacted.
- [ ] The usage ring opens an expanded inspector (popover within the composer chrome realm, not a transcript card) listing the categories with `~` approximation markers on estimated values and exact marks only for provider-authoritative numbers. Small and readable; not a tokenizer debugger (docs/11 constraint). Verified by jsdom tests and manual review.
- [ ] The spec 006 Memory chip expands to show: checkpoint continuation summary, ledger (decisions/artifacts/open work/next steps), source entry bounds, and token estimate, inside the measured virtual row without a fake assistant message or nested scroll container. Verified by jsdom test + manual check.
- [ ] All new copy is localized in all 10 catalogs with sentence case; the approximation marker convention is documented.
- [ ] Estimated versus authoritative labeling is testable: given provider usage present, the inspector displays it as authoritative; absent, everything estimated is marked.

## Scope and non-goals

In scope:

- Envelope calculator in core (host-neutral; consumable by React without touching `engine/pi` directly; expose through the existing usage/ports seams that already feed `UsageInfo`).
- `UsageMeter` inspector UI + CSS module (registered in `styles/manifest.mjs`), keyboard/aria access to open and close it.
- Checkpoint expansion content wired to spec 005's parsed `Checkpoint` data; fallback content for legacy compaction entries (summary text only, still marked estimated).
- Reserved-output/compaction-reserve/safety-margin defaults recorded as Decisions with rationale.

Not in scope:

- Provider-specific tokenizers (explicit docs/11 non-goal); precision beyond the existing content-aware estimator.
- Changing what compaction summarizes or the checkpoint schema itself (spec 005).
- Agent Group/timeline/inspector/shelf (spec 008).
- Settings surface for tuning reserves (only add if a Decision later demands it; defaults first).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Envelope categories follow the context assembler's real composition, collapsed to the docs/11 display list | docs/11: "Exact categories may follow the context assembler, but the display should stay small" | WS-01, WS-03 |
| 2026-07-15 | Inspector opens from the existing ring; no second context indicator is added anywhere | docs/11 prohibits competing context indicators | WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Core envelope calculator + category decomposition + conservative defaults, provider-usage override | Unassigned | Pending | None | New unit suite with fixture sessions; deterministic numbers |
| WS-02 | Wire `shouldAutoCompact` to the envelope; headroom regression tests | Unassigned | Pending | WS-01 | Compaction trigger suites green + new headroom cases |
| WS-03 | Context Inspector popover on `UsageMeter` (categories, `~` markers, authoritative override display) + CSS + i18n | Unassigned | Pending | WS-01 | jsdom tests; `check-i18n-dead-keys`; manual review |
| WS-04 | Checkpoint expansion in the Memory chip (summary, ledger, source bounds, estimate) + legacy-entry fallback | Unassigned | Pending | Spec 005 WS-01/03, spec 006 WS-05 | jsdom tests + manual compaction/resume check |
| WS-05 | A11y + i18n completeness pass (keyboard open/close, aria labeling, 10 locales, sentence case) | Unassigned | Pending | WS-03, WS-04 | Lint sentence-case 0 warnings; placeholder-parity test |

Guidance for low-context agents:

1. Data must reach React through existing port/store seams (`ChatUiStore` snapshot or `SettingsPorts`-style injection); `packages/pivi-react` must not import `engine/pi` (architecture check).
2. Estimated values always render with the approximation marker; never print an estimated number bare (docs/11 "avoid presenting false precision").
3. The inspector is chrome near the composer, not a transcript element; do not add a scrollable card inside the transcript.
4. Follow the same styles/i18n rules as spec 006 (manifest registration, `pivi-*` classes, 10-locale mirror, sentence case).

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- Deterministic envelope numbers on fixtures; compaction-trigger regression suites.
- Manual: long session near the limit in a real vault; verify inspector values are plausible, compaction triggers with headroom, checkpoint chip expands correctly after compaction; check pop-out window.
- `obsidian dev:errors` clean.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Conservative context envelope, Context Inspector, Memory layer sections).
- Nearest local guidance: `packages/pivi-react/AGENTS.md`, `packages/pivi-agent-core/AGENTS.md` (envelope ownership).
- Parent/package guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md` if compaction policy wiring changes.
- Root guidance and roadmap: `AGENTS.md` architecture status (context accounting claim).

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: no inspector exists in `packages/pivi-react`; estimator confirmed in `piContextCompaction.ts`; ring behavior confirmed in `UsageMeter.tsx`.
- Remaining: all workstreams.
- Blockers: WS-04 blocked until spec 005 WS-01/WS-03 and spec 006 WS-05 land; WS-01/WS-02 can start immediately.
- Next action: claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
