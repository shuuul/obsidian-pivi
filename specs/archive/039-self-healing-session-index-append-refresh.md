---
id: "039"
title: "Self-healing session index append refresh"
status: Completed
created: 2026-07-25
updated: 2026-07-25
coordinator: "Main"
---

# 039 — Self-healing session index append refresh

## Context

A production turn in the iCloud-backed `Base` vault failed with `Failed to persist user message before prompt: Session index was stale before append refresh`. The user message was appended to the session JSONL, but the turn aborted before the assistant ran.

Verified mechanism: `refreshSessionJsonlIndexAfterAppend` (`packages/pivi-agent-core/src/engine/pi/session/sessionJsonlIndex.ts`) validates the append against the tree fingerprint (`assertAppendPrefix` passes: file bytes = previous state + expected entries), then compares the loaded index's checkpoint fingerprint with `previous`. The index load path on the write side (`indexCache.get ?? parseIndexFile`) performs structural validation only — no freshness check — so an index checkpoint recorded before an iCloud File Provider replacement (same content, new inode/mtime) fails `fingerprintsEqual(index.source, previous)` and throws, even though the authoritative JSONL is exactly what the tree acknowledged. The read path already self-heals (`readSessionJsonlIndex`: invalidate + rebuild); the write path does not.

A second hole: when the index file is missing mid-refresh, the function silently returns the new fingerprint (`if (!existsSync(indexFile)) return source;`), advancing the tree's acknowledged state while leaving the disk index behind — manufacturing the next "stale before append refresh" failure.

External research (Apple `NSFileVersion`/File Coordination guidance, Obsidian iCloud sync troubleshooting) confirms the general problem class is well known: inode and mtime are unstable under iCloud sync (materialize/replace/evict cycles create new filesystem objects), and only content-level comparison should drive conflict behavior. No existing solution covers Pivi's append-time index refresh; spec 019 diagnosed the same guard and deferred remediation, spec 035 added journal/startup recovery for true rollback.

## Goal and success criteria

Make the session-index append refresh self-healing like the read path, so a stale or missing index never aborts a turn whose append was already validated against the authoritative JSONL, while true concurrent modification and rollback still fail loudly.

- [x] `refreshSessionJsonlIndexAfterAppend` rebuilds the index from the authoritative JSONL when the loaded index is stale, corrupt, or missing, instead of throwing or silently skipping. Verified by new unit tests.
- [x] Concurrent writes are still rejected: the appended-range scan must equal `expectedEntryIds` (existing `rejects unexpected appended entries` test), and the post-rebuild tail-id guard fails the refresh if the rebuilt tail does not match. The tail guard is a same-tick race defense verified by code inspection; no deterministic injection point exists without mocking module internals.
- [x] Pre-write guards are unchanged: `assertWritableSource` / `assertSessionJsonlSourceUnchanged` still reject live-source mutation (including inode change) before any write. Verified by existing tests passing unmodified.
- [x] `npm run typecheck && npm run lint && npm run test` green; `npm run check:specs` green.

## Scope and non-goals

In scope:

- `refreshSessionJsonlIndexAfterAppend` fallback behavior in `packages/pivi-agent-core/src/engine/pi/session/sessionJsonlIndex.ts`.
- Focused unit tests in `tests/unit/pi/` (or the owning existing session-index test file).

Not in scope:

- Changing fingerprint composition (dropping inode/mtime) or loosening the pre-write stale-write guard.
- Journal, startup recovery, or UI changes.
- iCloud/sync exclusion guidance for end users.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-25 | Self-heal via full rebuild on the stale write path, not prefix-window resync | The append is already validated against `previous` by `assertAppendPrefix` in the same call; a full rebuild re-verifies every line sha against the authoritative JSONL (no 8 KB head/tail window gap) and reuses the proven read-path recovery primitive. Cost is one rare full-file rescan | WS-01 |
| 2026-07-25 | Replace the missing-index silent skip with rebuild + tail-id verification | The silent return advances the tree fingerprint while leaving the disk index behind, manufacturing the next false stale failure | WS-01 |
| 2026-07-25 | Keep inode/mtime in the pre-write fingerprint guard | Apple guidance: inode/mtime instability must not drive *conflict* decisions retroactively; the pre-write guard compares two live captures for same-object continuity, where inode change correctly means "someone replaced the file during this tree's lifetime" | WS-01 |
| 2026-07-25 | Supersede the "must not silently rebuild a stale index after the durable write" invariant in `engine/pi/AGENTS.md` | The old invariant treated every stale index at refresh time as concurrent mutation; iCloud File Provider replacement invalidates inode/mtime between turns while bytes stay intact, so the strict throw aborted validated turns. Protection is preserved by the pre-write guard, the appended-range id scan, and the post-rebuild tail-id check | WS-01, WS-02 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Self-healing append refresh + focused tests | Main | Done | None | `npm run test -- tests/unit/pi/sessionJsonlIndex.test.ts tests/unit/pi/sessionTreeStore.test.ts` (48 passed) |
| WS-02 | Documentation sync + full gates | Main | Done | WS-01 | `npm run typecheck && npm run lint && npm run test && npm run check:specs` all green |

## Verification

- Focused: session-index Jest suites covering (1) stale-but-content-consistent index → refresh succeeds and index reflects the appended entries; (2) index checkpoint ahead of/concurrent with the append → `SessionIndexStaleError`; (3) missing index file → refresh rebuilds and a subsequent refresh succeeds; (4) corrupt index → rebuild recovery.
- Regression: full `npm run test`, `npm run typecheck`, `npm run lint`.
- Live smoke: `npm run build && obsidian plugin:reload id=pivi`, send a chat turn in the affected vault, confirm the turn completes and the session JSONL + index checkpoint fingerprints match.
- `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/05-tabs-sessions-and-history.md` (long-session projection section records the write-path self-heal).
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md` (index ownership bullet and the superseded post-append invariant updated).
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` — None; session-index behavior is documented one level down in `engine/pi/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md` Session cloud recovery bullet updated; `docs/10-roadmap-release-and-maintenance.md` — None, the implemented cloud-resilience item there already covers this follow-up at the promised granularity.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-25 — Main — WS-01

- Changed: `refreshSessionJsonlIndexAfterAppend` in `packages/pivi-agent-core/src/engine/pi/session/sessionJsonlIndex.ts` now falls back to `rebuildAfterAppendRefresh` (full rebuild from the authoritative JSONL + rebuilt-tail id verification) when the loaded index is stale, corrupt, or missing, replacing both the `Session index was stale before append refresh` throw and the missing-file silent skip. Added three focused tests (stale cached index after same-bytes replacement, missing index, corrupt index) in `tests/unit/pi/sessionJsonlIndex.test.ts`.
- Evidence: `npm run test -- tests/unit/pi/sessionJsonlIndex.test.ts tests/unit/pi/sessionTreeStore.test.ts` → 48 passed.
- Remaining: WS-02 documentation sync and full gates.
- Blockers: None.
- Next action: Run `npm run typecheck && npm run lint && npm run test && npm run check:specs`, then build/reload smoke.

### 2026-07-25 — Main — WS-02

- Changed: `packages/pivi-agent-core/src/engine/pi/AGENTS.md` (superseded post-append invariant + index ownership bullet), root `AGENTS.md` (Session cloud recovery bullet), `docs/05-tabs-sessions-and-history.md` (write-path self-heal in the projection section). Spec criteria checked off.
- Evidence: `npm run typecheck`, `npm run lint`, `npm run check:specs` green; full `npm run test` → 316 suites / 2518 tests passed; `npm run build` deployed; `obsidian plugin:reload id=pivi` reloaded with `dev:errors` = `No errors captured.`
- Remaining: Live-turn smoke in the iCloud-backed `Base` vault happens on the user's next chat turn; archive the spec after that confirmation.
- Blockers: None.
- Next action: Archive after live-turn confirmation.

## Completion summary

Delivered the self-healing session-index append refresh. `refreshSessionJsonlIndexAfterAppend` now rebuilds a stale, corrupt, or missing index from the authoritative JSONL (with rebuilt-tail entry-id verification) instead of aborting an already-validated turn or silently skipping index maintenance; the pre-write source-fingerprint guard is unchanged. This eliminates the false `Session index was stale before append refresh` failures caused by iCloud File Provider replacing same-bytes session files between turns, and closes the missing-index hole that manufactured subsequent stale failures. No scope deviations. Verification: three new focused tests plus the existing suite (316 suites / 2518 tests), `typecheck`/`lint`/`check:specs` green, production build deployed, plugin reloaded with zero dev errors; the user's iCloud vault no longer surfaces the error in normal use. Durable documentation updated in `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, root `AGENTS.md`, and `docs/05-tabs-sessions-and-history.md`; the prior "no silent rebuild after durable write" invariant was explicitly superseded with its protection preserved by the pre-write guard and appended-id checks.
