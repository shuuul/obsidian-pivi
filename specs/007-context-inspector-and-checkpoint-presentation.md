---
id: "007"
title: "Conservative context envelope, Context Inspector, and checkpoint presentation"
status: Active
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
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
| 2026-07-16 | Reserve defaults cap at 16K output / 12K compaction / 8K safety for large windows, scaling down to 25% / 10% / 5% for smaller windows | Matches the docs/11 conservative 200K example without making 32K windows unusable; no provider tokenizer or settings knobs are introduced | WS-01, WS-02 |
| 2026-07-16 | Only the provider-reported total may be authoritative; every category split and reserve remains explicitly estimated | Provider usage exposes one aggregate total and cannot truthfully make locally decomposed categories exact | WS-01, WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Core envelope calculator + category decomposition + conservative defaults, provider-usage override | Codex | Done | None | 5 deterministic envelope cases; type/lint green |
| WS-02 | Wire `shouldAutoCompact` to the envelope; headroom regression tests | Codex | Pending | WS-01 | Compaction trigger suites green + new headroom cases |
| WS-03 | Context Inspector popover on `UsageMeter` (categories, `~` markers, authoritative override display) + CSS + i18n | Codex | Pending | WS-01 | jsdom tests; `check-i18n-dead-keys`; manual review |
| WS-04 | Checkpoint expansion in the Memory chip (summary, ledger, source bounds, estimate) + legacy-entry fallback | Codex | Pending | Spec 005 WS-01/03, spec 006 WS-05 | jsdom tests + manual compaction/resume check |
| WS-05 | A11y + i18n completeness pass (keyboard open/close, aria labeling, 10 locales, sentence case) | Codex | Pending | WS-03, WS-04 | Lint sentence-case 0 warnings; placeholder-parity test |

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

### 2026-07-16 — Activation — Codex

- Changed: activated the spec, assigned every workstream to Codex, and confirmed specs 005/006 are archived, so checkpoint and Memory-boundary dependencies are satisfied.
- Problem recorded: the draft assumes provider totals can simply "override estimates," but `UsageInfo` currently carries one provider total while the inspector requires category decomposition. WS-01 must preserve the authoritative total without falsely presenting estimated category splits as authoritative.
- Verification: `npm run check:specs` before activation commit.
- Remaining: WS-01 through WS-05.
- Next action: audit the real prompt/context composition and define the smallest host-neutral envelope contract that both compaction policy and React can consume.

### 2026-07-16 — WS-01 conservative envelope contract — Codex

- Changed: added a host-neutral `ContextEnvelope` model and pure calculator covering system, recent conversation, selected context, tool/Agent results, checkpoints, reserved output, compaction reserve, safety margin, usable input, and the conservative trigger. Added optional envelope/authoritative-total facts to `UsageInfo` without changing existing consumers.
- Evidence: a 200K window yields the documented 16K/12K/8K reserves and 164K usable input; a 32K window scales reserves to 8K/3.2K/1.6K instead of producing negative capacity. A provider total replaces only the aggregate and leaves category sources estimated.
- Verification: `npm run test -- --runInBand tests/unit/pivi-agent-core/contextEnvelope.test.ts` (5 tests); `npm run typecheck`; `npm run lint`.
- Remaining: WS-02 through WS-05.
- Next action: route the envelope trigger into automatic/preflight compaction without weakening any existing trigger.

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: no inspector exists in `packages/pivi-react`; estimator confirmed in `piContextCompaction.ts`; ring behavior confirmed in `UsageMeter.tsx`.
- Remaining: all workstreams.
- Blockers: WS-04 blocked until spec 005 WS-01/WS-03 and spec 006 WS-05 land; WS-01/WS-02 can start immediately.
- Next action: claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
