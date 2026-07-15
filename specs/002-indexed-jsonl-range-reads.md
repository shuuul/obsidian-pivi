---
id: "002"
title: "Indexed JSONL range reads and partial durable hydration"
status: Active
created: 2026-07-15
updated: 2026-07-16
coordinator: "Codex"
---

# 002 — Indexed JSONL range reads and partial durable hydration

## Context

`docs/11-chat-ui-evolution.md` (Data and performance direction, step 2) targets true recent-first hydration. Verified current state:

- `packages/pivi-agent-core/src/engine/pi/session/piSessionStore.ts` (`PiSessionStore`): `open()`, `getMessages()`, `getUsage()`, `readUiContext()` each call `SessionTreeStore.openSnapshot()`, which opens and parses the complete JSONL file through the upstream Pi `SessionManager`, then maps every entry via `messageMapper.entriesToChatMessages()`.
- Before WS-01, `packages/pivi-agent-core/src/engine/pi/session/sessionTreeStore.ts` called the private Pi `_rewriteFile()` after every append. WS-01 changed normal message/custom/compaction writes to Pi's public typed append methods after one eager header bootstrap, so prior bytes now remain stable. There is still no byte-offset index; the only existing index is Pi's in-memory `_buildIndex()`.
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
| 2026-07-15 | Use true append after one eager header bootstrap; reserve rewrites for truncate and upstream migration | Installed Pi 0.80.6 updates its in-memory entry/index/leaf state and calls `appendFileSync` from every public typed append when `flushed=true`; a real-package compatibility test proves byte-prefix stability and reopen semantics | WS-01, WS-02, WS-04 |
| 2026-07-15 | Store the optimization as append-only `<session>.jsonl.pivi-index` JSONL sidecars with UTF-8 byte offsets, line hashes, chained checkpoints, and bounded source fingerprints | Normal appends update without O(n) sidecar rewrites; nanosecond stat identity plus head/tail hashes detect source replacement, per-line hashes detect offset mismatch, and the line checksum chain detects sidecar edits; atomic full rebuild always starts from JSONL | WS-02, WS-03, WS-04, WS-06 |
| 2026-07-16 | Validate every cached live session source before mutation and reject stale writes; never repair a mismatch silently after append | A stale Pi manager can otherwise append an obsolete parent chain before index refresh notices external replacement. Preflight protects the authoritative file, postflight requires the exact appended entry IDs, and either failure evicts the live cache and raises a typed error | WS-02, WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Write-path investigation and decision: can `SessionTreeStore` append without `_rewriteFile()` while preserving Pi header/entry semantics? Documented decision + prototype test | Codex | Done | None | Test proving JSONL produced by the new path is byte-compatible with Pi `SessionManager.open()` |
| WS-02 | Index format + lifecycle (build, incremental update on append, invalidate on truncate/fork/external change, rebuild) in `engine/pi/session/` | Codex | Done | WS-01 | New unit suite under `tests/unit/pi/` covering all lifecycle transitions |
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

### 2026-07-15 — Activation and write-path audit — Codex

- Changed: activated spec 002, assigned coordination, and claimed WS-01; no storage code changed before the upstream write semantics are proven.
- Evidence: current `SessionTreeStore.flushToDisk()` calls private Pi `_rewriteFile()` after user, agent, metadata, UI, and compaction appends; `PiSessionStore` opens full snapshots for messages, usage, and UI context; React's 100-message page is only an in-memory projection.
- Remaining: prove whether current Pi entries can be appended byte-compatibly while keeping manager memory/index state coherent, then record the blocking write-path decision.
- Blockers: none.
- Next action: inspect the installed Pi `SessionManager` implementation and add a prototype compatibility test before selecting the write path.

### 2026-07-15 — WS-01 true-append decision — Codex

- Changed: normal user, assistant/tool, Pivi custom-entry, UI-context, message-UI, and compaction writes no longer call `_rewriteFile()` after Pi has already persisted them. Session creation still writes the header eagerly once, while redo truncation remains a deliberate full rewrite.
- Evidence: installed `@earendil-works/pi-coding-agent@0.80.6` routes public typed appends through `_appendEntry()` and `_persist()`; with Pivi's existing eager `flushed=true` bootstrap, `_persist()` uses `appendFileSync` both before and after the first assistant. `piSessionAppendCompatibility.test.ts` runs the real installed ESM package in a child process, verifies every old byte remains a prefix across Unicode user/custom/assistant/compaction writes, and reopens the result with `SessionManager.open()` while preserving entries, leaf, custom-entry exclusion, and compaction context.
- Verification: `npm run test -- --runInBand tests/unit/pi/sessionTreeStore.test.ts tests/integration/piSessionAppendCompatibility.test.ts` (2 suites / 19 tests passed); temporary direct prototype reopened 3 incrementally appended entries with the same session id.
- Remaining: WS-02 through WS-07.
- Blockers: none.
- Next action: design the byte-offset index around UTF-8 line boundaries, treating truncate, migration, fork creation, and external file replacement as rebuild/invalidation boundaries.

### 2026-07-15 — WS-02 index format and lifecycle — Codex

- Changed: added a rebuildable `.pivi-index` sidecar with UTF-8 byte offsets, entry/custom/role metadata, per-line SHA-256 values, an index-line checksum chain, and append checkpoints carrying file size, device/inode, nanosecond mtime/ctime, and bounded head/tail hashes. Rebuild uses a temporary file plus rename; normal indexed appends extend the sidecar; truncate/bootstrap/fork/delete paths invalidate sidecars.
- Evidence: source replacement or truncation raises `SessionIndexStaleError`; malformed or edited sidecars raise `SessionIndexCorruptError`; an indexed-line checksum/identity mismatch also raises the stale error. Both errors live in the host-neutral session contract. JSONL scanning uses Buffer offsets, including Unicode fixture coverage.
- Verification: `npm run typecheck`; `npm run lint`; `npm run check:boundaries`; `npm run test -- --runInBand tests/unit/pi/sessionJsonlIndex.test.ts tests/unit/pi/sessionTreeStore.test.ts tests/unit/pi/piSessionStore.test.ts` (3 suites / 43 tests passed after the accepted stale-write guard revisions).
- Remaining: WS-03 through WS-07; WS-06 will connect the existing external-context rewrite to the same explicit index invalidation/done-marker lifecycle.
- Blockers: none.
- Next action: expose bounded `openRecent(limit)` / `readOlder(beforeEntryId, limit)` semantics through `SessionStore`, keeping raw offsets engine-private.

### 2026-07-16 — WS-02 stale-write review resolution — Codex

- Changed: after review, all live append, truncate, and fork mutations now validate the held source fingerprint before touching Pi manager state. A mismatch evicts the cached store and raises `SessionIndexStaleError`. Append postflight verifies the unchanged prefix and exact new entry IDs; it no longer catches index failures and silently rebuilds after a durable write. The sidecar also records `message_ui.targetEntryId`, one-time external-context migration state, and delegates legacy Pi format upgrades to `SessionManager.open()` before offset construction.
- Evidence: regression coverage rejects a changed live source before `appendMessage`, unexpected tail entries, same-size edits with restored mtime, torn checkpoints, edited offsets, and stale held-index batch reads. Unicode offsets, target overlay IDs, v1 migration delegation, migration-marker reset, replacement/rebuild, and append-only sidecar prefixes remain covered.
- Verification: `npm run typecheck && npm run lint && npm run check:boundaries`; 4 focused suites / 44 tests; `npm run build && npm run check:bundle-size` (`main.js` 2,987,023 bytes); `obsidian plugin:reload id=pivi`; `obsidian dev:errors` (`No errors captured.`).
- Remaining: WS-03 through WS-07.
- Blockers: none; the user approved the pre-mutation typed-failure direction on 2026-07-16.
- Next action: run the full WS-02 gate, commit the verified index lifecycle, then begin the range API.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
