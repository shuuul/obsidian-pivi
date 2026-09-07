---
id: "054"
title: "Tool-result context overflow and in-turn pressure"
status: Active
created: 2026-09-07
updated: 2026-09-07
coordinator: "Amp (T-01a079c6)"
---

# 054 — Tool-result context overflow and in-turn pressure

## Context

Live session `2026-09-06T16-29-08-678Z_01a0778d-5ec6-7dba-9b11-11d67bdcc562.jsonl` (vault `/Users/shuuul/obsidian/Base`) overflowed a 256K custom OpenAI-compatible model (`qwen3.8-flash-next`) after one user turn.

Verified sequence:

1. Last successful assistant usage was **71,403 tokens** (`input` 70,963 + `output` 440) at line 34, `stopReason: toolUse`, three `obsidian_search` calls.
2. Line 35 is one `toolResult` whose text is **1,340,014 characters** of pretty-printed search JSON (vault-wide hits with match context). Local structured estimate is ~335K–447K tokens.
3. The next provider continuation (line 38) failed with `400 input_tokens=262144`, `requested 1 output tokens`. The overflow diagnostic still reported `Current context usage: ~71K tokens` because `piAgentEventAdapter.enhanceContextOverflowError` prints last known assistant usage, not projected pressure.
4. Auto-compaction then failed with the same 400: Pass 1/2 sampling sends the already-over-window prefix, including that search result.

This is not “compaction never ran at 85%.” Compaction **cannot see** the new tool result at the continuation barrier, then **cannot shrink** a payload that already exceeds the window.

### When context usage is calculated

Usage is **not** only computed after a full human↔agent turn. There are four moments:

| Moment | Owner | What it counts | What the UI shows |
|---|---|---|---|
| Assistant `message_end` | `streamPiChatTurn` subscribe | Provider `input + cacheRead + cacheWrite` (authoritative) | Meter `contextTokens` = that provider total |
| Tool-result `message_end` | same subscribe | Full local estimate of `agent.state.messages`, then envelope | Meter may update **if** this event has already fired |
| Before the next provider continuation | `prepareNextTurnWithContext` | Last successful assistant usage + `attachContextEnvelope(..., pendingMessages: [])` | Compact decision uses envelope pressure; meter still prefers authoritative `contextTokens` |
| After `prompt()` returns, and before the next **user** turn | post-turn `shouldAutoCompactSession` / `prepareContextForTurn` | Same envelope | Prefire Pass 1 can start 10 points early |

The hole is the continuation barrier. Pi calls `prepareNextTurnWithContext` with `nextTurn.context.messages` / `toolResults` that already contain the giant result. Pivi then:

1. Flushes only `pendingPersistenceMessages` collected from prior `message_end` events.
2. Calls `attachContextEnvelope(deps, latestUsage, turn, [])` — **empty pending list**.
3. `latestUsageFromMessages` walks `nextTurn.context.messages` but keeps the last **successful assistant** usage (71K). Error/aborted assistants are skipped.
4. If the tool-result `message_end` has not been persisted into the session tree yet, `findProviderAnchor` trailing estimate is **0**.
5. `shouldAutoCompactSession` sees ~71K vs ~222K trigger (85% of 256K) and lets the request go.
6. The provider receives the real messages, including the 1.34M-char result.

Composer ring (`UsageMeter`) is `contextTokens / contextWindow`. Warning fill is `pressureInputTokens / compactionTriggerTokens`. Overflow copy uses `contextTokens`. A giant tool result can therefore sit in the next request while every user-visible number still says 71K.

**Meter start:** estimation does not wait for overflow or for a later user turn. After the first user→assistant exchange there is either a provider anchor or a full local estimate, and the meter must show that number. After that, every tool result is added as trailing pressure **before** the next provider continuation, so the ring moves as soon as the tool returns, not after the next 400.

Spec 047 already switched pressure to provider-anchor + trailing estimate and made read a fixed ceiling, relying on “compaction preflight before the next provider request.” That preflight does not currently include not-yet-anchored tool results. This spec closes that gap and caps the tools that can jump the window in one call.

## Goal and success criteria

A tool result must not be able to send a provider request past the context window. Pressure at the continuation barrier must include every message that will actually be sent. Oversized tool output must truncate or page instead of dumping the vault into JSONL.

- [ ] `prepareNextTurnWithContext` computes envelope pressure from the messages Pi is about to send (`nextTurn.context.messages` / `newMessages` / `toolResults`), not from an empty pending list. A fixture with last assistant usage 71K plus a 1.3M-char tool result on a 256K window must compact or block **before** `agent.prompt` / `continue` is called. File: `tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts`.
- [ ] If compaction cannot produce a next request under the trigger, the continuation is aborted with a localized notice. The oversized tool result is not sent. Same test file plus `piChatRuntimeCompactionUsage.test.ts`.
- [ ] Overflow diagnostics print **projected pressure**, not only last assistant `contextTokens`. `tests/unit/engine-pi/runtime/piAgentEventAdapter.test.ts`.
- [ ] Composer meter `contextTokens` follows envelope `pressureInputTokens` from the first user→assistant exchange, and immediately after each tool result (not only after the next provider round-trip). A 71K anchor plus a trailing 1.3M-char tool result must move the ring off 71K before the continuation is sent. `tests/jsdom/pivi-react` or existing usage projection tests.
- [ ] `search` **requires** a non-empty vault-relative `path` to one Markdown note or one folder that is not the vault root. Omitting `path`, empty `path`, `/`, and a path that resolves to the vault root are errors that tell the Agent to pick a folder or note. `tag:` queries still need that same `path` scope. Tests: `tests/unit/obsidian-tools/searchTool.test.ts` plus `obsidianVaultApi` search tests.
- [ ] `search` also has a serialized-result character ceiling (same order as `ls` 50,000), a hard `limit` maximum, and truncated match-context lines. A scoped `context: true` search cannot return a 1.3M-char JSON payload. Same test files.
- [ ] Every other unbounded tool in the inventory below either gains a documented ceiling or is explicitly deferred with a reason in Decisions. Inventory test or architecture check fails if a new ToolSpec returns unbounded text without a named cap.
- [ ] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test -- tests/unit/engine-pi/runtime/piChatRuntimeTurn.test.ts tests/unit/engine-pi/runtime/piChatRuntimeCompactionUsage.test.ts tests/unit/engine-pi/runtime/piAgentEventAdapter.test.ts` plus the new search/cap tests. `spec_check` before closeout.

## Scope and non-goals

In scope:

- Continuation-barrier pressure: pass live tool results into `attachContextEnvelope` / `findProviderAnchor` before the next provider request.
- Block or compact when that pressure is at/over the existing 85% trigger; never send an over-window continuation.
- Truthful overflow copy and meter pressure after tool results.
- Result-size ceilings for P0 tools, starting with `search` (required `path` plus character cap), then MCP call, `spawn_agent` parent text, `write`/`edit` arguments, `tags`, and CLI fallbacks.
- Tests and `AGENTS.md` updates listed under Documentation sync.

Not in scope:

- Changing the 85% trigger, 10-point prefire, 95/5 two-pass split, or checkpoint schema (047 / 018).
- Adding a tokenizer or provider `count_tokens` API (047).
- Shrinking the `read` 500K ceiling back into a pressure-derived budget (047 #99).
- Rewriting search to semantic/Obsidian in-app search. Literal substring + optional `tag:name` stay; only the scan scope and payload size change.
- Repairing the already-overflowed live session file.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-07 | Pressure at `prepareNextTurnWithContext` must include `nextTurn` tool results even if session JSONL has not flushed them. | Live overflow: Pi's next request contained the 1.34M-char result while `attachContextEnvelope(..., [])` saw trailing 0. Flush-then-empty-pending is racy against `message_end`. | WS-01 |
| 2026-09-07 | Keep provider-anchored accounting. Do not return to full-session `max(provider, estimate)`. | 047; estimator error must stay on the trailing suffix. | WS-01 |
| 2026-09-07 | If in-turn compaction fails or cannot get under the trigger, **abort the continuation**. Do not send the over-window request and hope post-turn compact will recover. | Compact sampling of an already-full window repeats the same 400. | WS-01 |
| 2026-09-07 | Meter and overflow copy must show projected pressure after trailing tool results, not only last assistant usage. Estimation starts at the first user→assistant exchange (provider anchor if present, else full local estimate) and updates on every tool-result `message_end` / continuation barrier. | User-visible `~71K` made the 256K overflow look like a meter bug. Ring stays `tokens/window`; the token **value** must include trailing estimates. Do not wait for a later human turn. | WS-01 |
| 2026-09-07 | Tool-result ceilings are serialized characters with an explicit truncation marker and continuation hint, matching `ls` / `bash` / `read`. | Character caps are the existing house style; no tokenizer in bundle. | WS-02, WS-03 |
| 2026-09-07 | P0: `search` **must** take a vault-relative `path` to one Markdown note or one non-root folder. Vault-wide scans (omitted/empty/`/`/vault-root `path`) are rejected. Character ceiling, max `limit`, and truncated context lines still apply inside that scope. Schema `path` becomes required; `promptUsage` and registered-tools Search copy drop “omit path for a vault-wide search” (052). CLI fallback must receive the same required path. | Live overflow was a vault-wide `context: true` dump. A char cap alone still lets the Agent scan every transcript. Scope first, then cap. | WS-02 |
| 2026-09-07 | P1 caps after search: MCP `call` result, `spawn_agent` parent-visible text (reports stay structured but size-limited), `write`/`edit` tool-call arguments, `obsidian_tags` list, CLI fallback stdout for search/links/history/tasks/base. | These can jump tens or hundreds of thousands of characters in one call. Graph already defaults `limit` 200; `ls` 50k; `bash` 20k; `WebFetch` 20k; `read` 500k. | WS-03 |
| 2026-09-07 | `read` keeps the 500K per-read / shared-turn ceiling. Overflow from a maxed read is WS-01's job, not a smaller read budget. | 047 / #99 paging loop. | WS-01 |
| 2026-09-07 | Do not persist calibration or change JSONL schema. | Memory-only calibration remains 047 policy. | All |
| 2026-09-07 | Search `context: true` remains allowed **inside the required path**, but each match line and the total payload are capped; remaining hits return `nextOffset` / truncated markers. | Prompt already says context dumps are not a substitute for `read`. The bug is missing enforcement. | WS-02 |

## Tool overflow inventory

Status as of 2026-09-07. “LLM context” means the tool result (and for write/edit, the tool-call arguments) are part of the next provider request.

### P0 — live overflow / no serialized cap

| Tool | Current bound | Gap |
|---|---|---|
| `search` | `path` optional (omit = vault-wide, 052); hit `limit` default 50; schema `limit` unvalidated; no char cap; `context` copies ±2 raw lines; CLI fallback unbounded | Live 1.34M-char JSON from a vault-wide scan. Spec now: required non-root `path` + char cap |
| MCP `mcp` call | Inventory search capped at 40; **call result unbounded** | Remote tools can return arbitrary text |
| `spawn_agent` | Report is structurally condensed; malformed/no-report child output is returned whole; `terminal_result` also stored | Child can dump a full file into the parent |
| `write` / `edit` | Result text is small (`Wrote …`); **arguments `content` / `newText` have no schema size cap** and remain in the assistant tool-call message | Session line 24 already stored a 14,332-char write argument |

### P1 — bounded count, unbounded or weakly bounded payload

| Tool | Current bound | Gap |
|---|---|---|
| `obsidian_tags` | None | Vault-wide tag JSON |
| `obsidian_links` | Per-note, but CLI fallback is raw stdout | Large backlink notes + CLI |
| `obsidian_history` / `obsidian_tasks` / `obsidian_base` / `obsidian_command` | CLI/process stdout capped through the shared CLI output helper | Bounded CLI result text |
| `WebSearch` | Max 20 results; only first 5 snippets formatted; snippet length uncapped | Usually small; not the live bug |
| `obsidian_graph` | Default 200 per action | Count-capped; watch serialized size |
| `obsidian_markdown_structure` | Default 200 headings | Heading titles only; low risk |

### Already capped (WS-01 still must catch a maxed result)

| Tool | Cap |
|---|---|
| `read` / external `read` | 1,000–500,000 chars/read, shared turn allowance; external also 10 MB bytes |
| `ls` | Max 200 entries, 50,000 serialized chars |
| `bash` | 256 KiB stdout/stderr capture, 20,000 model-visible chars |
| `WebFetch` | 500–20,000 chars (default 12,000) |

## Workstreams

| ID | Deliverable | Owner | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Continuation-barrier pressure includes live tool results; compact or abort before send; meter starts at first user→assistant exchange and updates on each tool result; overflow copy uses projected pressure | Amp (T-01a079c6) | Done (`c8f5e827`) | None | Turn test: 71K anchor + 1.3M-char tool result never calls continue and moves the meter off 71K; adapter test for diagnostic text |
| WS-02 | `search` requires non-root `path`; serialized-char ceiling, max `limit`, capped context lines, CLI fallback truncation, continuation marker; promptUsage + registered-tools Search copy drop vault-wide omit-path | Amp (T-01a079c6) | Done (`e7ae1bee`) | None | Unit: missing/empty/`/`/vault-root `path` errors; scoped `context: true` payload ≤ ceiling; listing-query tests stay green |
| WS-03 | P1 ceilings: MCP call, spawn_agent parent text, write/edit argument guidance or cap, tags list, remaining CLI fallbacks | Amp (T-01a079c6) | Done (`6d272def`) | WS-02 pattern | Per-tool tests + inventory comment/check that new unbounded ToolSpecs fail review |
| WS-04 | Docs/`AGENTS.md`: when usage is counted, search/tool caps, overflow recovery | Amp (T-01a079c6) | Done | WS-01, WS-02 | `check:docs-contracts` / `check:specs`; handbook + package guides name the continuation barrier |

## Verification

- Fixture reproducing the live session shape: last assistant usage 71,403 on a 262,144 window, then one `toolResult` ≥ 1,000,000 characters. Expect compact or abort; expect **no** provider continuation. After a compact failure, expect a notice, not a second 400 send.
- `search` without `path`, with empty `path`, with `/`, or with a path that resolves to the vault root errors and does not call `searchNotes`.
- `search` with `context: true` over a **required folder or note** of long-line transcripts returns ≤ the new character ceiling and a truncation/continuation marker.
- Overflow error text includes projected pressure ≥ last assistant usage when trailing tool results exist.
- `npm run check:specs` before closeout.
- No rendered-CSS change; no human visual sign-off item.

## Documentation sync

- Durable product/developer docs: `docs/11-chat-ui-evolution.md` (compaction preflight must mention tool-result trailing pressure; meter starts at first exchange). Search required-`path` + cap numbers in `packages/obsidian-tools/AGENTS.md` and `packages/engine-pi/AGENTS.md`.
- Nearest local `AGENTS.md`: `packages/engine-pi/AGENTS.md` (continuation barrier), `packages/obsidian-tools/AGENTS.md` (search requires path, not vault-wide), `packages/agent/AGENTS.md` (MCP/Web ceilings; registered-tools Search sentence).
- Parent/package guidance: root `AGENTS.md` glossary already defines Turn vs Message vs Checkpoint; add **continuation barrier** only if the term is used in product copy. Prefer package guides.
- Root guidance and roadmap: `docs/10-roadmap-release-and-maintenance.md` only if this ships as a numbered release note item.

### Experiment refs

None.

## Progress and handoff

### 2026-09-07 — Amp (T-01a079c6) — spec

- Changed: Reserved 054, filled decision-complete Active spec from the live 71K vs 262144 overflow.
- Evidence: session JSONL line 34 usage 71403, line 35 1,340,014-char search result, line 38 400; `piChatRuntimeTurn.ts` `attachContextEnvelope(..., [])`; `search.ts` has no char cap.
- Remaining: WS-01 through WS-04 implementation.
- Blockers: None.
- Next action: Implement WS-01 (continuation-barrier pressure) in parallel with WS-02 (required search path + cap).

### 2026-09-07 — Amp (T-01a079c6) — decisions

- Changed: Meter estimation starts at the first user→assistant exchange and updates on every tool result. `search` must take a non-root folder or note `path`; vault-wide omit-path is rejected. Char cap still applies inside that scope.
- Evidence: Owner instruction; 052 currently documents “omit path only for a vault-wide search.”
- Remaining: WS-01 through WS-04 implementation.
- Blockers: None.
- Next action: Implement WS-01 or WS-02.

### 2026-09-07 — Amp (T-01a079c6) — implementation

- Changed: WS-01 continuation-barrier pressure (`c8f5e827`). WS-02 required non-root `search` path + 50k cap (`e7ae1bee`). WS-03 MCP/spawn_agent/tags/write/edit/CLI caps (`6d272def`). WS-04 docs/`AGENTS.md` sync.
- Evidence: Focused unit tests for turn pressure, search path/cap, MCP call cap, spawn_agent parent text, tags list, write/edit argument rejection.
- Remaining: Archive after owner review; do not push unless asked.
- Blockers: None.
- Next action: Reload the vault plugin and start a **new** session; do not continue the overflowed tab.

## Completion summary

Complete this section before archiving.
