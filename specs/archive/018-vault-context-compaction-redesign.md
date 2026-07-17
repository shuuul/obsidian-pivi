---
id: "018"
title: "Vault context compaction redesign"
status: Completed
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex /root"
---

# 018 — Vault context compaction redesign

## Context

Pivi already has conservative context-envelope budgeting, manual and threshold compaction, additive structured checkpoints, and Memory-boundary presentation. This change adopts grok-build's prefire and two-pass shape while adapting the prompts, evidence model, persistence, and failure semantics to durable Obsidian vault conversations.

## Goal and success criteria

Ship a fixed-policy, vault-native two-pass compaction flow that prepares `NOTE₁` from the first 95% of active context and produces a full-replacement `NOTE₂` from `NOTE₁` plus the remaining raw 5%.

- [x] Current Pivi trigger, summary, persistence, recovery, and failure paths are mapped to source and tests.
- [x] Grok-build mechanisms are verified against a pinned upstream commit.
- [x] Candidate changes distinguish reusable conversation mechanisms from coding-workspace-specific behavior.
- [x] Recommended work is prioritized with concrete verification scenarios and explicit non-goals.
- [x] Automatic compaction uses a fixed bounded 85% trigger and starts an invisible Pass 1 ten context-window percentage points earlier.
- [x] Manual and automatic compaction produce a validated vault-native checkpoint through the same two-pass path, with a full-context fallback.
- [x] The next LLM context contains only `NOTE₂`, while append-only JSONL history, transcript presentation, reopen, and fork remain intact.
- [x] Compaction settings are removed and legacy fields are stripped on load; `/compact [instructions]` remains available.

## Scope and non-goals

In scope:

- Earlier/background Pass 1, two-pass summarization, prompt/schema improvements, failure suppression, and vault-native continuity.
- Session/checkpoint compatibility, model-switch behavior, cancellation, and user-visible status implications.
- Full-replacement LLM context using an invisible custom JSONL boundary.
- Removal of compaction settings while preserving the manual command.

Not in scope:

- Rewriting or deleting the authoritative pre-compaction JSONL trace.
- Copying coding-specific file-state prompts or transcript-segment storage.
- Adding a new checkpoint schema version or a user-selectable compaction model.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Treat grok-build as behavioral prior art and adapt its prompt to Obsidian vault work. | Coding-workspace state does not map directly, but staged summarization and early preparation do. | WS-01, WS-02, WS-03 |
| 2026-07-17 | Replace active LLM context with only `NOTE₂`; preserve raw JSONL and transcript history. | The user wants Grok-style full replacement without losing durable review, reopen, or fork history. | WS-04, WS-05 |
| 2026-07-17 | Prefire prepares an immutable in-memory `NOTE₁`, never an early session mutation. | Speculative work can hide latency without premature Memory boundaries or sync writes. Applying requires an exact prefix/session/model/prompt-version match. | WS-06 |
| 2026-07-17 | Harden summary validity and failure semantics before adding background work. | The current single sample accepts empty or degenerate text, falls back from malformed structured output to arbitrary legacy text, and has no classified retry suppression. Background execution would amplify those failure modes. | WS-04 |
| 2026-07-17 | Build compaction input from typed vault evidence rather than truncated raw transcript strings. | Pivi must preserve verified note paths/actions, user intent, decisions, and failures while removing reasoning noise, redacting device paths, and avoiding mid-JSON truncation. | WS-05 |
| 2026-07-17 | Use the active chat model for compaction initially. | The current title-generation model preference can select a smaller or narrower-context model that is unsuitable for a safety-critical continuation checkpoint. A dedicated model setting is unnecessary until measurements justify it. | WS-04 |
| 2026-07-17 | Fix automatic policy at a bounded 85% trigger, with Pass 1 ten window percentage points earlier and a 95/5 token split. | Compaction settings are removed; one deterministic policy is easier to validate and explain. | WS-04, WS-06 |
| 2026-07-17 | Keep `/compact [instructions]`; apply instructions only to final `NOTE₂`. | Manual control remains useful, while `NOTE₁` stays a reusable objective prefix summary. | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Map current Pivi compaction behavior and gaps. | Codex /root | Done | None | Source/test inventory with exact paths |
| WS-02 | Independently verify Pivi trigger, persistence, and failure semantics. | `/root/verify_pivi_compaction` | Done | None | Read-only findings reconciled with repository source |
| WS-03 | Verify grok-build mechanisms and produce a vault-native prioritized design. | Codex /root | Done | WS-01, WS-02 | Pinned upstream source plus scenario matrix |
| WS-04 | Implement fixed trigger, two-pass sampling, validation, retry/suppression, current-model choice, and cancellation ownership. | Codex /root | Done | WS-01–WS-03 | Failure, retry, model/session switch, cancel, tool-boundary, and manual-command tests |
| WS-05 | Add token-aware vault evidence, checkpoint output protocol, and full-replacement custom boundary. | Codex /root | Done | WS-04 | CJK, wikilink, note action, path redaction, malformed output, installed-Pi context, reopen/fork tests |
| WS-06 | Add invisible prefire preparation and exact-prefix application. | Codex /root | Done | WS-04, WS-05 | Prefire hit/stale/cancel/apply and concurrent-store tests |
| WS-07 | Remove compaction settings and synchronize presentation/search/i18n/docs. | Codex /root | Done | WS-04 | Codec cleanup, settings UI absence, command retention, build/reload |

## Verification

- Focused source review of `packages/pivi-agent-core/src/engine/pi/session/piContextCompaction.ts`, `piChatRuntimeCompaction.ts`, and `piChatRuntimeTurn.ts`.
- Focused Jest inventory under `tests/unit/pi/piChatRuntime.systemPrompt.test.ts`, `tests/unit/engine/pi/piContextCompaction.test.ts`, and context-envelope/checkpoint tests.
- Upstream verification against xai-org/grok-build commit `8adf9013a0929e5c7f1d4e849492d2387837a28d`.
- Acceptance covers prefire invalidation, cancellation, failed-summary suppression, reopen/fork compatibility, CJK/vault-link preservation, structured role/tool sampling, orphan-boundary safety, and shared-store foreground serialization.
- A prefire cache key must cover session identity, exact compacted prefix content, first-kept entry, active model, prompt/schema version, and cut policy. Appended tail entries may reuse the draft only when the compacted prefix remains byte-for-byte equivalent.
- Background preparation must never append JSONL, create a transcript row, or survive session switch, rewind, model switch, plugin unload, policy change, or explicit cancellation.
- The active policy is fixed and enabled by default; no new persisted settings or compatibility mode may be added.
- Run `npm run check:specs` before closing or committing this spec.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` if durable compaction behavior changes.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md` for runtime/session behavior changes.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` for public boundary changes.
- Root guidance and roadmap: `AGENTS.md` only if canonical terminology or repo-wide behavior changes.

## Progress and handoff

### 2026-07-17 — Codex /root — WS-01 / WS-03

- Changed: Mapped the current Pivi implementation, verified grok-build at the pinned commit, and recorded a vault-native phased design.
- Evidence: Pivi previously compacted synchronously before an oversized turn or after a completed turn; grok-build prefire caches a fingerprinted prefix summary and validates it before its second pass. Pi's append-only JSONL and custom-entry semantics allow full replacement of active model context without deleting durable raw history.
- Remaining: User approval and implementation of WS-04 onward.
- Blockers: None.
- Next action: Implement WS-04 as the correctness prerequisite.

### 2026-07-17 — `/root/verify_pivi_compaction` — WS-02

- Changed: Read-only verification; no files modified.
- Evidence: Confirmed preflight/post-turn timing, leaf-scoped success-only attempt state, lack of compaction-runner cancellation ownership, session-switch state leakage risk, and current UI chunk boundaries.
- Remaining: Covered by WS-04 and WS-06.
- Blockers: None.
- Next action: Add lifecycle and race regression tests before introducing background prefire.

### 2026-07-17 — Codex /root — WS-04–WS-07

- Changed: Implemented fixed 85%/10%/95:5 policy, invisible Pass 1, current-model tool-less sampling, structured Pass 2, validated vault checkpoint output, bounded fallback, cancellation/suppression, shared-store write serialization, and full-replacement Pi compaction through an invisible custom boundary. Removed all compaction settings and retained `/compact [instructions]`.
- Evidence: Reused Pi `buildContextEntries`, `findCutPoint`, `estimateTokens`, `sessionEntryToContextMessages`, `convertToLlm`, `CompactionEntry`, and `buildSessionContext` semantics. Focused Jest passed across compaction runtime, sampler, session persistence, installed-Pi compatibility, settings migration, and React settings. Full Jest passed 257 suites / 1966 tests. `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run check:specs` passed. The final bundle deployed, `obsidian plugin:reload id=pivi` succeeded, and a clean `obsidian dev:errors` check reported no errors.
- Remaining: None.
- Blockers: None.
- Next action: Archive this completed spec and hand off the implementation.

### 2026-07-17 — Codex /root — post-review correctness closure

- Changed: Preserved trailing Memory boundaries across both full and paged reopen, revalidated session/model/generation/context identity before compaction append, made threshold compaction run Pass 1 when no reusable prefire exists, and matched prefire fingerprints against the filtered Pi-active entries used to build the draft.
- Evidence: Added immediate-reopen, concurrent shared-session append/model-change, automatic two-pass, interleaved `pivi/message-ui` prefire, and compaction-cursor paging regression coverage. Full Jest passed 258 suites / 1973 tests; `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and an in-memory production bundle all passed.
- Remaining: None.
- Blockers: None.
- Next action: Commit the reviewed fix set.

## Completion summary

Pivi now uses a fixed-policy two-pass `NOTE₁`/`NOTE₂` flow over Pi-native context, cut-point, message, and compaction primitives. The active model context is fully replaced by `NOTE₂`, while raw JSONL/UI history remains append-only and compatible with reopen and fork. Compaction settings and legacy persisted fields are removed; `/compact [instructions]` remains available.
