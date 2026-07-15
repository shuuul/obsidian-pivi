---
id: "002"
title: "Indexed JSONL range reads and partial durable hydration"
status: Draft
created: 2026-07-15
updated: 2026-07-15
coordinator: "Unassigned"
---

# 002 — Indexed JSONL range reads and partial durable hydration

## Context

`docs/11-chat-ui-evolution.md` (Data and performance direction, step 2) targets true recent-first hydration. Verified current state:

- `packages/pivi-agent-core/src/engine/pi/session/piSessionStore.ts` (`PiSessionStore`): `open()`, `getMessages()`, `getUsage()`, `readUiContext()` each call `SessionTreeStore.openSnapshot()`, which opens and parses the complete JSONL file through the upstream Pi `SessionManager`, then maps every entry via `messageMapper.entriesToChatMessages()`.
- `packages/pivi-agent-core/src/engine/pi/session/sessionTreeStore.ts` (`SessionTreeStore`) owns `appendUserMessage`, `syncAgentMessages`, `appendMessageUi`, `appendCompaction`, `truncateAfter`, `forkToNewFile`, and a static `liveByKey` cache. Critically, `flushToDisk()` calls the private Pi `_rewriteFile()`, so **every append currently rewrites the entire file**. There is no byte-offset or entry index anywhere; the only index is Pi's in-memory `_buildIndex()`.
- The "recent 100" limit lives in the React layer, not storage: `CHAT_PROJECTION_PAGE_SIZE = 100` in `packages/pivi-react/src/store/chatProjectionStore.ts`; `replaceAll()` projects the tail and `prependPreviousPage()` reveals older already-parsed in-memory pages. Memory and parse cost therefore stay O(session length).
- The external-context migration (`migrateSessionFileIfPresent` / `stripExternalContextsFromSessionJsonl`) performs an additional full read per lazy open.

Design concern (must be resolved by a Decision before implementation): docs/11 assumes an offset index over an append-mostly file, but the current write path rewrites the whole file on every append. An index over a fully rewritten file is invalidated on every turn. This spec therefore includes the write-path question, which docs/11 does not spell out.

## Goal and success criteria

Outcome: the session layer can hydrate the latest bounded entry range without parsing the complete file, page older ranges on demand, and keep every durable behavior correct when only part of the transcript is hydrated.

- [ ] Opening a session reads only a bounded recent range (target: newest N entries plus the header and any entries required for LLM context correctness, such as trailing compaction entries from `getLinearLlmContextEntries()`), verified by a unit test that counts bytes/entries read on a 5K-message fixture.
- [ ] Older ranges can be prepended by stable entry/message ID through a new `SessionStore` range API, and `ChatProjectionStore.prependPreviousPage()` is fed from it instead of from a fully parsed in-memory array.
- [ ] The index is rebuilt or invalidated safely after external modification (mtime/size/hash check), after append, truncate, fork, and compaction, and a rebuild from the raw JSONL is always possible. Verified by tests that corrupt/replace the file and assert explicit failure plus successful rebuild.
- [ ] Save, redo (`truncateAfter`), fork (`forkToNewFile`), compaction, and model-context assembly behave identically whether the UI is fully or partially hydrated. Verified by extending existing session suites.
- [ ] Mismatched index offsets fail explicitly (typed error), never silently return wrong entries.
- [ ] Before/after cold-open latency for the 5K fixture is recorded using the spec 001 harness.

## Scope and non-goals

In scope:

- Index design and lifecycle inside `packages/pivi-agent-core/src/engine/pi/session/` (index is engine-side; the `SessionStore` port in core exposes only range semantics).
- Write-path decision: either (a) make appends true appends with an incremental index update, keeping `_rewriteFile()` only for truncate/fork/migration, or (b) keep rewrites and rebuild the cheap index from the rewrite buffer in the same operation. Option (a) is preferred if Pi `SessionManager` semantics allow it; record the choice as a Decision with evidence.
- Moving the external-context migration check behind the index (migrate once, record done-marker in index metadata) so lazy opens stop re-reading full files.
- Feeding `packages/pivi-react/src/store/chatProjectionStore.ts` paging from the range API through existing `ChatPorts` seams (`@pivi/pivi-agent-core/runtime/chatPorts`), wired in `src/ui/chat` controllers.

Not in scope:

- A second durable source of truth. The index is an optimization; JSONL stays authoritative (docs/11 rule).
- Changing the Pi-compatible JSONL entry format or the `message_ui` schema.
- Transcript search, tokenizers, UI visual changes.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Index must never be trusted over the file: any mismatch (size, mtime, offset checksum) triggers explicit invalidation and full rebuild | docs/11: "fail explicitly when indexed offsets no longer match the session file" | WS-02, WS-04 |
| 2026-07-15 | Write-path choice (true append vs rewrite-with-index-refresh) is the first implementation task and blocks the rest | The current `flushToDisk()` full rewrite determines whether offsets can be stable at all | WS-01 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Write-path investigation and decision: can `SessionTreeStore` append without `_rewriteFile()` while preserving Pi header/entry semantics? Documented decision + prototype test | Unassigned | Pending | None | Test proving JSONL produced by the new path is byte-compatible with Pi `SessionManager.open()` |
| WS-02 | Index format + lifecycle (build, incremental update on append, invalidate on truncate/fork/external change, rebuild) in `engine/pi/session/` | Unassigned | Pending | WS-01 | New unit suite under `tests/unit/pi/` covering all lifecycle transitions |
| WS-03 | Range read API on the session layer (`openRecent(limit)`, `readOlder(beforeEntryId, limit)`) surfaced through `SessionStore`/`ChatPorts` | Unassigned | Pending | WS-02 | Typecheck + port contract tests |
| WS-04 | Partial-hydration correctness: redo/fork/compaction/save with partially hydrated UI; explicit-failure tests for stale offsets | Unassigned | Pending | WS-03 | Extend `tests/unit/pi/sessionTreeStore*`-adjacent suites |
| WS-05 | UI paging hookup: `prependPreviousPage()` requests older ranges via ports; keep TanStack prepend anchoring stable | Unassigned | Pending | WS-03 | `tests/pivi-react/MessageList.test.tsx` prepend cases + manual scroll test in Obsidian |
| WS-06 | Migration interplay: external-context migration runs once per file, recorded so lazy opens skip full reads | Unassigned | Pending | WS-02 | Migration idempotence tests remain green |
| WS-07 | Before/after measurements with spec 001 harness (cold open, older-page load, append cost on 5K fixture) | Unassigned | Pending | WS-05, spec 001 | Recorded traces in Progress and handoff |

Guidance for low-context agents:

1. Read `packages/pivi-agent-core/src/engine/pi/AGENTS.md` and `packages/pivi-agent-core/src/session/` types before touching storage.
2. Never modify files under `node_modules/@earendil-works/`; interact with Pi only through the existing shim/adapter surface in `engine/pi`.
3. Any new typed error belongs in core `foundation` or session types, not ad-hoc `throw new Error` strings, if an error family already exists there.
4. Keep `tests/integration/**` JSONL compatibility fixtures green; old session files must open unchanged.

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build`
- JSONL compatibility: existing session/compat suites plus new fixtures for partially hydrated redo/fork.
- Manual: open a real 104-session vault (release-validation vault from root AGENTS.md), confirm history list, resume, fork, redo, compaction.
- Performance: spec 001 traces before/after; claims require both numbers.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Indexed JSONL range reads section becomes "implemented" with the chosen write-path decision) plus the session/persistence numbered doc.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md` architecture status if the storage claim changes.

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: full-file read confirmed in `piSessionStore.ts` / `sessionTreeStore.ts`; full rewrite per append confirmed in `flushToDisk()` → `_rewriteFile()`.
- Remaining: all workstreams; WS-01 blocks the rest.
- Blockers: none.
- Next action: claim WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
