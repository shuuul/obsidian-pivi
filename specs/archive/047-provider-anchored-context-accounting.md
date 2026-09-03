---
id: "047"
title: "Provider-anchored context accounting and compaction recovery"
status: Completed
created: 2026-09-02
updated: 2026-09-03
coordinator: "Droid (research session 2026-09-02)"
---

# 047 — Provider-anchored context accounting and compaction recovery

## Context

Two open GitHub issues expose the same root cause from different sides:

- **#98 “Auto-compaction fails `Cancelled` status”** — a mid-turn threshold compaction fails with `Cancelled`, the post-turn retry fails the same way, and the next user message is blocked with *“This turn is too large to send safely within the fixed context budget”*. A manual `/compact` then succeeds and the conversation continues normally.
- **#99 “Force respect endLine option in file read”** — near the compaction threshold, `obsidian_read` returns ten-line pages (~35k characters) for a 60-line request, and the Agent responds by re-reading and copying earlier pages verbatim.

Verified current state (all paths relative to the repository root):

1. **The local estimate overrides provider usage.** `calculateContextEnvelope` sets `pressureInputTokens = max(providerContextTokens, estimatedTotal)` (`packages/agent/src/runtime/usage.ts`). `estimatedTotal` is a full re-estimate of system prompt, tool schemas, and every active message via `estimateTextTokens` (`packages/agent/src/prompt/estimateTextTokens.ts`) and `estimateAgentMessageTokens = max(piviEstimate, piCharsOver4)` (`packages/engine-pi/src/session/piContextCompaction.ts`). Because the local estimate is usually higher than the provider total, `contextTokensIsAuthoritative` rarely changes any decision.
2. **The pre-send gate ignores provider usage entirely.** `prepareContextForTurn` compares `estimateProjectedTurnTokens` (pure local estimate of session + system + prompt) against `getCompactionThresholdTokens` and emits the “too large to send safely” error (`packages/engine-pi/src/runtime/piChatRuntimeCompaction.ts`, `prepareContextForTurn`).
3. **The estimator is neither accurate nor uniformly conservative.** Measured against `js-tiktoken` on 2026-09-02 (o200k_base): English Markdown containing one fenced block 1.45× (the `looksStructured` flag switches the whole text to 3 chars/token when any ``` fence appears), TypeScript 1.17×, JSON 1.06×, Chinese/Japanese prose 1.29–1.35×, **Markdown tables with dense digits/punctuation 0.66× (under-estimate)**. With a 200k window and a 164k trigger, a real ~115k-token session can already be blocked.
4. **Upstream Pi already implements the mature pattern.** `estimateContextTokens()` in `@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` anchors on the last valid assistant `usage` (`totalTokens || input + output + cacheRead + cacheWrite`) and estimates only the trailing messages after that index with `chars/4`. Pivi imports `estimateTokens` from the same module but not the anchoring logic. Claude Code, Codex CLI, and OpenCode use the same provider-anchored approach.
5. **Compaction timeout is reported as cancellation.** `sampleCompactionNote` (`packages/engine-pi/src/runtime/piCompactionSampler.ts`) shares one `AbortController` for the caller signal and the 120 s timeout and throws `Error('Cancelled')` for `stopReason === 'aborted'`. `sampleFallback` checks the *outer* signal before deciding whether to retry, so a timeout retries three times at up to 120 s each. Sampling a ~160k-token prefix plus up to 8192 output tokens on a slower provider plausibly exceeds 120 s; this is the most consistent explanation for #98 but is unconfirmed without logs.
6. **One failed automatic compaction permanently blocks the fingerprint.** `compactUnlocked` returns `null` when `failedAutoFingerprint === fingerprint` for `reason === 'threshold'`, and `prepareContextForTurn` then falls through to the blocking error; only manual `/compact` clears the state.
7. **The read budget shrinks with pressure.** `calculateReadToolMaxTokens` = `min(cap, contextWindow − reservedOutput − pressureInputTokens)`; the shared `PiReadBudget` reserves that allowance per turn (`packages/engine-pi/src/runtime/piReadBudget.ts`). Near the trigger the allowance collapses toward the 1000 floor, producing the #99 paging loop. An uncommitted working-tree change (2026-09-02) converts the budget from characters to estimated tokens and adds a `defaultReadMaxChars` Tools setting; it keeps explicit `maxChars` bounded by the token allowance and evaluates `estimateTextTokens` + `looksStructured` on every binary-search candidate.
8. **Real tokenizers are ruled out for now.** `main.js` is 4.19 MB against the 5 MB ceiling enforced by `scripts/check-bundle-size.mjs`; o200k rank data alone is ~4 MB, cl100k ~1.7 MB. Anthropic Claude 3+ and Gemini tokenizers are not public (only remote `count_tokens` APIs), and local models differ per family. `docs/11-chat-ui-evolution.md` already records the decision not to integrate provider tokenizers; this spec keeps it.

This work is long-running because it touches three packages (`@pivi/agent`, `@pivi/engine-pi`, `@pivi/obsidian-tools`), changes the semantics of `pressureInputTokens` consumed by the composer meter, and needs coordinated tests plus documentation updates.

## Goal and success criteria

Make context pressure, the pre-send gate, automatic compaction, and the read budget derive from the provider-reported anchor plus a bounded estimate of only what changed since that anchor, and make compaction failures recoverable and truthfully labelled.

- [x] With an authoritative provider usage present, `pressureInputTokens` equals `providerAnchor + estimate(trailing messages after the anchored assistant message) + selectedContext`, never a full re-estimate. Verified by unit tests in `tests/unit/agent/runtime/usageProjection.test.ts` and `tests/unit/engine-pi/runtime/piChatRuntimeCompactionUsage.test.ts`.
- [x] `prepareContextForTurn` uses the same anchored pressure and no longer emits the blocking error when the anchored projection is below the trigger. Verified by a regression test reproducing #98: authoritative usage of 120k on a 200k window, local full estimate of 170k, new prompt of 2k tokens → the turn is sent without compaction or error.
- [x] A compaction sampling timeout is reported as a timeout (distinct message from user cancellation), and the fallback loop does not retry a timed-out sample more than once. Verified by `tests/unit/engine-pi/runtime/piCompactionSampler.test.ts` and a new fallback-loop test.
- [x] A failed automatic compaction does not permanently block the same fingerprint: the next `prepareContextForTurn` retries once, and if that fails the user sees a localized notice that names manual `/compact` as the recovery path instead of the generic “too large to send” error. Verified by `tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts`.
- [x] `estimateTextTokens` scores fenced/JSON blocks separately from surrounding prose and applies a digit/punctuation-density adjustment so that, on the fixed corpus in WS-04, no sample deviates from o200k by more than ±25% (previously 0.66×–1.45×). Verified by `tests/unit/agent/prompt/estimateTextTokens.test.ts` with recorded reference counts (no tokenizer dependency in the repo).
- [x] A per-model calibration ratio (`providerTotal / localEstimate` at the anchored message, clamped to [0.6, 1.5]) is applied to trailing estimates and to the read allowance; absent provider usage the ratio is 1. Verified by unit tests; the ratio is in-memory only and never persisted to synced settings or session JSONL.
- [x] The read allowance no longer collapses toward the 1000-token floor near the trigger: reads honor the configured default (or an explicit `maxChars`) up to a fixed per-read ceiling, and overflow is handled by the existing compaction preflight rather than by shrinking pages. A reproduction of #99 (60 requested lines, ~3.5k characters per line, pressure at 80% of window) returns the complete range in one call. Verified by `tests/unit/obsidian-tools/**/readNoteCharacterPagination.test.ts` and `tests/unit/engine-pi/runtime/piReadBudget.test.ts`.
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size` pass with no new dependencies.
- [x] `docs/11-chat-ui-evolution.md`, `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`, and `packages/obsidian-tools/AGENTS.md` describe the anchored accounting, calibration, timeout labelling, retry policy, and read-budget policy.

## Scope and non-goals

In scope:

- Provider-anchored pressure in `calculateContextEnvelope` and its engine-side inputs (`attachContextEnvelope`, `estimateProjectedTurnTokens`, `shouldAutoCompactSession`, `prepareCompactionPrefire`).
- Bounded in-memory calibration ratio per `provider/modelId`.
- Segment-aware `estimateTextTokens` / `looksStructured` replacement.
- Compaction sampler timeout labelling and fallback retry policy.
- `failedAutoFingerprint` retry-once policy and localized recovery notice (i18n in the same commit).
- Read-budget policy change to a fixed per-read ceiling, reconciled with the uncommitted token-based read-budget change.
- Tests, docs, and `AGENTS.md` updates listed under Documentation sync.

Not in scope:

- Bundling or downloading any tokenizer (tiktoken, gpt-tokenizer, llama tokenizers) or calling provider `count_tokens` APIs.
- Changing the fixed 85% trigger, the 95/5 two-pass split, or the checkpoint schema.
- Changing the composer usage ring semantics (`contextTokens / contextWindow`); only the pressure input changes.
- Constructing pi-coding-agent `AgentSession` (see root `AGENTS.md`).
- Reworking `obsidian_read` pagination coordinates (`startLine` / `startChar` continuation from spec 045 remains as is).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-02 | Adopt provider-anchored accounting (`anchor + trailing estimate`) instead of `max(provider, full estimate)`. | Matches upstream Pi `estimateContextTokens`, Claude Code, Codex CLI, and OpenCode; confines estimator error to a few trailing messages instead of the whole context. Measured full-estimate error is 0.66×–1.45×. | WS-01, WS-02 |
| 2026-09-02 | Do not add a tokenizer dependency. | o200k rank data (~4 MB) would exceed the 5 MB bundle ceiling (`main.js` is 4.19 MB); Claude 3+/Gemini tokenizers are not public; local models vary. Reaffirms `docs/11-chat-ui-evolution.md`. | All |
| 2026-09-02 | Calibration ratio is in-memory, per `provider/modelId`, clamped to [0.6, 1.5], reset on plugin load. | Cheap convergence toward provider behavior without persistence or schema changes; clamps bound damage from a single anomalous usage report. | WS-01, WS-06 |
| 2026-09-02 | Keep the anchor only from assistant messages whose `stopReason` is neither `aborted` nor `error` and whose total is > 0, mirroring upstream `getAssistantUsage`. | Aborted/error messages carry zero or partial usage. | WS-01 |
| 2026-09-02 | Distinguish timeout from cancellation in `sampleCompactionNote`; fallback retries a timed-out sample at most once. | Timeouts on a ~160k prefix are the most plausible #98 trigger; three back-to-back 120 s timeouts leave the user waiting six minutes for a misleading `Cancelled`. | WS-03 |
| 2026-09-02 | Replace permanent `failedAutoFingerprint` blocking with retry-once plus a localized recovery notice that names `/compact`. | The current policy converts one transient failure into a hard block that only manual `/compact` clears. | WS-03 |
| 2026-09-02 | Read allowance becomes a fixed per-read ceiling (configured default or explicit `maxChars`, capped at a constant), not a function of pressure; large reads rely on the compaction preflight. | Shrinking pages near the trigger is what produces the #99 loop; Claude Code / Codex use fixed read caps and let compaction absorb pressure. Explicit `maxChars` satisfies the #99 “force complete read” request. | WS-05 |
| 2026-09-02 | The uncommitted char→token read-budget change is paused until WS-01 lands; WS-05 decides which parts (e.g. `defaultReadMaxChars` setting) are kept. | The change makes pagination depend on per-candidate `estimateTextTokens` + `looksStructured` (`JSON.parse` in a binary search) and still bounds explicit `maxChars` by the pressure-derived allowance. | WS-05 |
| 2026-09-02 | Consolidate estimator, calibration, and envelope under one `@pivi/agent` module (`src/runtime/contextAccounting/` or `src/tokens/`); `prompt/` re-exports `estimateTextTokens` for the Prompt-tab usage panel. | Three overlapping “authorities” exist today (`estimateTextTokens`, `estimateAgentMessageTokens = max(...)`, envelope `max(...)`). No package-boundary change; relative imports inside `@pivi/agent` only. | WS-01, WS-04 |
| 2026-09-03 | Owner accepted the remaining real-Obsidian checks; the forced compaction-timeout manual scenario is downgraded to unit coverage plus production-log observation. | Owner inspected Settings → Tools → Read (relocated controls), the usage meter, and large ranged reads in the live plugin. Forcing a compaction timeout with a lowered constant requires a throwaway dev build for one path already covered by `tests/unit/engine-pi/runtime/piCompactionSampler.test.ts` (`reports the internal deadline as a distinguishable timeout`). | WS-03, WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `@pivi/agent` context-accounting module: `ContextAnchor` type (`tokens`, `anchoredMessageIndex`/entry id, `model`), `calculateContextEnvelope` accepting `anchor` + `trailingEstimate` instead of relying on `max()`, calibration registry (`getCalibration(modelKey)`, `observeProviderUsage(modelKey, providerTotal, localEstimate)`), `prompt/` re-export preserved. | Amp | Done | None | `npm run test -- tests/unit/agent/runtime/usageProjection.test.ts`; new `tests/unit/agent/runtime/contextAccounting.test.ts` |
| WS-02 | Engine wiring: `attachContextEnvelope`, `buildEstimatedUsageInfo`, `estimateProjectedTurnTokens`, `shouldAutoCompactSession`, `prepareCompactionPrefire`, and `prepareContextForTurn` compute pressure from the anchored assistant entry in `SessionTreeStore` linear context plus trailing entries (reuse `PiContextTokenIndex.tokensBetween`); `PiChatRuntimeTurn` calls `observeProviderUsage` at each authoritative usage. | Amp | Done | WS-01 | `npm run test -- tests/unit/engine-pi/runtime/piChatRuntimeCompactionUsage.test.ts tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts`; #98 regression test |
| WS-03 | Compaction failure semantics: `PiCompactionTimeoutError` (or equivalent discriminator) from `sampleCompactionNote`; `sampleFallback` retries timeout once; `failedAutoFingerprint` → `failedAutoAttempts` map with retry-once; localized notice key (all locales) naming `/compact`; `piChatRuntimeTurn.ts` notice text uses translated content supplied through existing runtime host/i18n route (engine-pi must not import app translator state). | Amp | Done | None | `npm run test -- tests/unit/engine-pi/runtime/piCompactionSampler.test.ts tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts`; `npm run check:i18n-dead-keys` |
| WS-04 | Segment-aware estimator: split text on fenced blocks; JSON detection per segment; digit/punctuation-density term; record fixed corpus reference counts (o200k, measured once outside the repo) as test fixtures; keep public signature `estimateTextTokens(text: string): number`. | Amp | Done | WS-01 (module location) | `npm run test -- tests/unit/agent/prompt/estimateTextTokens.test.ts`; every corpus sample within ±25% of reference |
| WS-05 | Read-budget policy: fixed per-read ceiling constant + configured default + explicit `maxChars` honored up to the ceiling; `PiReadBudget` keeps per-turn parallel-sibling fairness but is no longer derived from pressure; reconcile or revert the uncommitted char→token change; update `obsidianAgentTools.ts` read guidance and tool schema descriptions; keep `defaultReadMaxChars` setting only if WS-05 confirms it is still meaningful. | Amp | Done | WS-02 | `npm run test -- tests/unit/engine-pi/runtime/piReadBudget.test.ts tests/unit/obsidian-tools`; #99 regression test |
| WS-06 | Calibration application: trailing estimates and read ceiling multiply by the model's calibration ratio; ratio observed only from authoritative usage; unit tests for clamp and reset behavior. | Amp | Done | WS-01, WS-02 | `npm run test -- tests/unit/agent/runtime/contextAccounting.test.ts` |
| WS-07 | Documentation sync and closeout: `docs/11-chat-ui-evolution.md` “Conservative context envelope” rewritten to “Provider-anchored context envelope”; `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`, `packages/obsidian-tools/AGENTS.md` updated; root `AGENTS.md` Architecture Status sentence on estimates updated; issue #98/#99 closing notes. | Amp | Done | WS-01…WS-06 | `npm run check:specs`; manual review of the four docs |

## Verification

Automated (run from the repository root):

```bash
npm run test -- tests/unit/agent/runtime/usageProjection.test.ts
npm run test -- tests/unit/agent/runtime/contextAccounting.test.ts
npm run test -- tests/unit/agent/prompt/estimateTextTokens.test.ts
npm run test -- tests/unit/engine-pi/runtime/piChatRuntimeCompactionUsage.test.ts
npm run test -- tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts
npm run test -- tests/unit/engine-pi/runtime/piCompactionSampler.test.ts
npm run test -- tests/unit/engine-pi/runtime/piReadBudget.test.ts
npm run test -- tests/unit/engine-pi/session/piContextCompaction.test.ts
npm run test -- tests/unit/obsidian-tools
npm run check:i18n-dead-keys
npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size
npm run check:specs
```

Required regression fixtures:

- **#98 fixture**: session with authoritative usage 120 000 on a 200 000 window; local full estimate ≥ 170 000; three trailing tool-result messages totalling ~6 000 estimated tokens; new prompt 2 000 tokens. Expect: no compaction, no blocking error, `pressureInputTokens ≈ 128 000`.
- **#98 timeout fixture**: sampler stream resolves `stopReason: 'aborted'` after the internal timeout fires while the caller signal is not aborted. Expect: timeout-typed error, one fallback retry, then a localized notice; `failedAutoAttempts` allows one more automatic attempt on the next turn.
- **#99 fixture**: 300-line note with ~3 500 characters per line, request `startLine=146, endLine=209`, pressure at 80% of a 200 000 window. Expect: complete 64-line range returned in one call under the default ceiling; `truncated: false`.
- **Estimator corpus** (reference counts measured once with `js-tiktoken` o200k_base outside the repo and stored as fixtures): English Markdown with one fence, TypeScript source, JSON, zh-CN JSON, Chinese prose, Japanese prose, digit-dense Markdown table, and pretty-printed fenced JSON. Expect: every `estimateTextTokens` result within ±25% of the reference.

Manual scenario (real Obsidian, configured vault, `npm run build && obsidian plugin:reload id=pivi`):

1. Run a long session with a slow provider until the composer meter passes 75%; confirm the meter percentage tracks the provider total plus a small trailing delta rather than jumping ahead of it.
2. Force a compaction timeout (temporarily lower `COMPACTION_SAMPLE_TIMEOUT_MS` in a dev build); confirm the notice says timeout, not `Cancelled`, and the next message is still sendable.
3. Request a 60-line range near the threshold; confirm one complete page.

No workstream changes rendered CSS; no human visual sign-off item is required. If WS-03's notice introduces new chrome styling, add a "Human visual sign-off" item before that workstream is marked `Done`.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (context envelope, compaction failure semantics, read-budget policy); `docs/07-tools-skills-mcp-and-integrations.md` if read-tool guidance text changes.
- Nearest local guidance: `packages/agent/AGENTS.md` (`runtime/` and `prompt/` ownership of estimator/calibration/envelope), `packages/engine-pi/AGENTS.md` (`piChatRuntimeCompaction.ts`, `piCompactionSampler.ts`, `piReadBudget.ts`, `piContextCompaction.ts` entries), `packages/obsidian-tools/AGENTS.md` (read budget policy).
- Parent/package guidance: none beyond the three package files; no package boundary changes.
- Root guidance and roadmap: `AGENTS.md` Architecture Status sentence “Provider usage remains authoritative when explicitly marked, while local estimates distinguish …” must be rewritten to describe anchored accounting; `docs/10-roadmap-release-and-maintenance.md` release notes entry when shipped.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-09-02 — Droid research session — Spec creation

- Changed: created this spec and its index entry. No code changed.
- Evidence: GitHub issues #98 and #99 (read via `gh api`); code paths cited in Context; estimator comparison run with `js-tiktoken@1` in a throwaway temp directory (numbers recorded in Context §3).
- Remaining: all workstreams.
- Blockers: the uncommitted working-tree change to the read budget (chars → tokens, `defaultReadMaxChars`) overlaps WS-05; coordinator must decide whether to stash, commit behind WS-05, or discard before WS-01/WS-02 start.
- Next action: claim WS-01 and WS-03 (independent); WS-04 may proceed in parallel once the module location from WS-01 is fixed.

### 2026-09-02 — Amp — WS-01 through WS-07 implementation

- Changed: replaced full-context `max(provider, estimate)` pressure with the last valid provider anchor plus calibrated trailing/selected estimates; added memory-only per-model calibration; made pre-send and in-turn compaction use the same projection; distinguished compaction timeout from caller cancellation and added bounded same-fingerprint recovery; restored fixed character read budgeting with a 500k hard ceiling and a configurable 50k/100k/200k/500k default; added segment-aware estimation, all-locale settings/recovery copy, regression coverage, and durable documentation.
- Evidence: `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and `npm run test:coverage` (347 suites / 3075 tests) passed. Production build passed; `main.js` is 4,195,603 bytes with 1,047,277 bytes headroom. `npm run check:bundle-size`, `npm run check:specs`, and `git diff --check` passed.
- Remaining: real-Obsidian checks for settings persistence, a long provider-backed usage meter, a large ranged read near the trigger, and timeout recovery. Do not archive until the user confirms those checks.
- Blockers: none in automated verification.
- Next action: reload the development build in Obsidian and run the manual scenarios listed above.

### 2026-09-02 — Amp + Oracle — vault estimator and Settings follow-up

- Changed: moved persistent built-in-tool configuration beneath its owning tool row (read size under Read, external access/roots under Read external, allowlist under Bash). A local-only, size-stratified o200k audit covered 197 of 1,729 vault Markdown files (11.7 MB): weighted ratio 0.978, median 0.962, p10 0.897, p90 1.038, with 195/197 inside ±25%. Oracle identified the 0.571 fenced-JSON outlier as a real class defect and found that selected context skipped per-model calibration. Added a JSON-specific structured-character floor and calibrated selected context.
- Evidence: the real-vault fenced-JSON outlier improved from 1,594 / 2,792 tokens (0.571) to 2,139 / 2,792 (0.766). Added a synthetic pretty-printed fenced-JSON fixture with a recorded o200k reference and an explicit selected-context calibration assertion. Typecheck, lint, boundaries, 347 coverage suites / 3,076 tests, production build, bundle-size, spec validation, and diff whitespace checks pass; `main.js` is 4,195,686 bytes with 1,047,194 bytes headroom.
- Remaining: inspect the relocated controls in real Obsidian.
- Blockers: none.
- Next action: build, reload Pivi, and inspect Settings → Tools → Read.

### 2026-09-03 — Grok 4.6 High — closeout

- Changed: Recorded owner acceptance of the live Settings → Tools → Read, usage-meter, and large ranged-read checks. Downgraded the forced compaction-timeout manual scenario to the existing sampler timeout fixture plus production-log observation. Set status Completed and archived the spec.
- Evidence: Owner confirmation 2026-09-03. Closeout re-ran focused suites: `usageProjection` + `contextAccounting` + engine compaction/turn/sampler/read-budget/session compaction — 7 suites / 56 tests; `estimateTextTokens` — 1 suite / 11 tests; `tests/unit/obsidian-tools` — 15 suites / 213 tests; `npm run check:i18n-dead-keys` passed (983 catalog / 986 referenced). Timeout path remains `PiCompactionTimeoutError` in `piCompactionSampler.test.ts`. Prior WS-07 already recorded typecheck, lint, boundaries, coverage, production build, and bundle-size.
- Remaining: none
- Blockers: none
- Next action: archived

## Completion summary

Shipped provider-anchored context pressure (`anchor + calibrated trailing/selected estimates`), a memory-only per-model calibration ratio, segment-aware `estimateTextTokens`, truthful compaction timeout labelling with one fallback retry, retry-once automatic-compaction recovery that names `/compact`, and a fixed per-read character ceiling that no longer shrinks with pressure (issues #98 and #99).

Deviation: the manual “force a compaction timeout with a lowered constant in a dev build” scenario is downgraded to the unit timeout fixture in `tests/unit/engine-pi/runtime/piCompactionSampler.test.ts` plus observation of production logs. Owner inspected and accepted Settings → Tools → Read (relocated controls), the usage meter, and large ranged reads in the live plugin.

Closeout verification (2026-09-03): `npm run test -- tests/unit/agent/runtime/usageProjection.test.ts tests/unit/agent/runtime/contextAccounting.test.ts tests/unit/engine-pi/runtime/piChatRuntimeCompactionUsage.test.ts tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts tests/unit/engine-pi/runtime/piCompactionSampler.test.ts tests/unit/engine-pi/runtime/piReadBudget.test.ts tests/unit/engine-pi/session/piContextCompaction.test.ts` — 7 suites / 56 tests passed; `npm run test -- tests/unit/agent/prompt/estimateTextTokens.test.ts` — 1 suite / 11 tests passed; `npm run test -- tests/unit/obsidian-tools` — 15 suites / 213 tests passed; `npm run check:i18n-dead-keys` — passed (983 catalog keys, 986 referenced). Skipped `test:coverage`, `build`, and `check:bundle-size`; those already have recorded WS-07 evidence.

Durable documentation already synced: `docs/11-chat-ui-evolution.md`, `docs/07-tools-skills-mcp-and-integrations.md` (read-tool guidance), `docs/10-roadmap-release-and-maintenance.md`, root `AGENTS.md` Architecture Status, `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`, `packages/obsidian-tools/AGENTS.md`.
