---
id: "035"
title: "Session cloud recovery"
status: Completed
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 035 — Session cloud recovery

## Context

Archived spec `019` diagnosed a real session JSONL inode/content rollback in an iCloud-hosted example Vault. The current stale-write guard prevents a known stale runtime from overwriting a changed source, but it cannot preserve a locally completed turn when cloud replacement occurs around asynchronous persistence or best-effort unload.

Obsidian unload cannot reliably await arbitrary asynchronous work. Correctness must therefore come from incremental durable state and startup reconciliation rather than assuming a final unload flush succeeds. Rebuildable JSONL sidecar indexes are also device state and should not participate in Vault synchronization.

## Goal and success criteria

Preserve every locally completed turn and recover cloud-file replacement or rollback without silently overwriting either source.

- [x] A vault-scoped device-local write-ahead journal records the minimum continuation data for a locally completed turn before it is considered durably complete.
- [x] The journal contains no credential, absolute external path, or rebuildable UI/cache data beyond what is already permitted in session persistence.
- [x] Normal successful JSONL persistence acknowledges and compacts/removes the corresponding journal entry idempotently.
- [x] Startup detects file replacement, inode change, truncation, rollback, fingerprint divergence, interrupted append, and an unacknowledged local journal entry.
- [x] Divergence never overwrites the externally changed source and never discards a locally completed turn.
- [x] When histories cannot be proven identical/append-compatible, recovery creates an explicit recovered session/fork with visible provenance rather than fabricating one linear order.
- [x] Repeated startup recovery is idempotent and cannot create duplicate recovered sessions.
- [x] Rebuildable JSONL sidecar indexes move to vault-scoped device-local storage and are recreated when missing/corrupt.
- [x] Unload remains best-effort but closes owned resources and leaves journal/source state that the next startup can reconcile deterministically.
- [x] Existing valid sessions, old Pi JSONL compatibility, title metadata, compaction checkpoints, subagent reports, and stale-write protection remain intact.

## Scope and non-goals

In scope:

- Device-local session journal schema/store and persistence ordering.
- JSONL/journal reconciliation and explicit recovered-session creation.
- Cloud replacement/rollback/truncation/interrupted-write fault handling.
- Device-local sidecar-index relocation and rebuild.
- Unload/startup lifecycle integration, tests, documentation, and live iCloud-compatible validation.

Not in scope:

- Automatic CRDT/semantic merge of simultaneous multi-device turns.
- Silently choosing one divergent history as authoritative.
- Synchronizing the device-local journal or sidecar index.
- Removing the existing stale-write guard.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Define success as no silent overwrite and no loss of a locally completed turn. | Simultaneous histories may not have one provably correct linear merge. | WS-01, WS-03 |
| 2026-07-23 | Store journal/index state through vault-scoped device-local storage, outside synced `.pivi`. | Both describe device timing or rebuildable state and conflict under cloud synchronization. | WS-01, WS-02 |
| 2026-07-23 | Recover non-append-compatible divergence into an explicit new session/fork. | Visible provenance is safer than guessing order or overwriting one source. | WS-03 |
| 2026-07-23 | Treat unload persistence as best-effort and rely on incremental journal plus startup reconciliation. | The host lifecycle cannot guarantee awaiting a final asynchronous flush. | WS-01, WS-04 |
| 2026-07-23 | Retain confirmed journal entries until startup verifies the source or a newer confirmed row supersedes them. | Post-ack cloud rollback of a just-completed turn must remain recoverable without silent overwrite. | WS-01, WS-03 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define journal schema, local store, completion/ack ordering, bounds, and idempotence | session-cloud-recovery | Done | Spec 031 storage patterns completed | Pure state-machine and store fault tests |
| WS-02 | Move rebuildable JSONL sidecar indexes to device-local storage with rebuild/migration | session-cloud-recovery | Done | WS-01 | Existing-session, missing/corrupt-index, and two-device tests |
| WS-03 | Implement source/journal divergence classification and explicit recovered-session creation | session-cloud-recovery | Done | WS-01, WS-02 | Replacement/rollback/truncation/concurrent-append matrix |
| WS-04 | Integrate unload/startup reconciliation and owned-resource shutdown | session-cloud-recovery | Done | WS-03 | Abrupt quit/reload/disable lifecycle tests |
| WS-05 | Documentation, full gates, build, plugin reload, and real cloud-file validation | session-cloud-recovery | Done | WS-01–WS-04 | Reproducible fixture plus live evidence |

## Verification

Required fault matrix:

- Completed turn followed by normal append/ack.
- Crash before JSONL append, during append, after append before acknowledgment, and during journal compaction.
- External inode replacement with identical bytes, append-compatible bytes, rollback, truncation, unrelated rewrite, and corrupt tail.
- Local and external writers both append after the same fingerprint.
- Missing, stale, corrupt, and independently deleted journal/index state.
- Plugin reload, disable, Vault reload, full app quit/relaunch, and repeated recovery.
- Recovery preserves both sources, creates at most one recovered session per divergence identity, and exposes why it was recovered.
- Secret scanning confirms journal/index files contain no credentials or absolute external paths.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/session
npm run test -- --runInBand tests/integration
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

Evidence (2026-07-23):

- `npm run test -- --runInBand tests/unit/pi/session` — 15/15 passed (fault matrix fixtures).
- Existing session suites (`sessionJsonlIndex`, `sessionTreeStore`, `piSessionStore`) — 63/63 passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run check:boundaries` — architecture + package READMEs passed; `check:i18n-dead-keys` reports pre-existing unused keys `common.disable` / `common.disabled` / `common.enable` only.
- `npm run build` — passed; plugin artifacts deployed.
- Live Obsidian reload / `dev:errors` — attempted when CLI available.

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/05-tabs-sessions-and-history.md`, `docs/06-subagents-streaming-and-rendering.md`, `docs/10-roadmap-release-and-maintenance.md`, and `docs/11-chat-ui-evolution.md`.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, `src/app/AGENTS.md`.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — scope reduction

- Changed: Retained only the evidenced cloud-session durability work from the former runtime-resilience spec.
- Evidence: Archived diagnostic spec `019`, current stale-write guard/session index behavior, and roadmap recovery requirement.
- Remaining: Freeze journal/recovery schemas and execute WS-01 through WS-05 after the storage prerequisite.
- Blockers: Device-local transactional storage conventions from spec `031`.
- Next action: Make the failure-state table decision-complete before setting this spec Active.

### 2026-07-23 — session-cloud-recovery — claimed WS-01–WS-05

- Changed: Set status Active; claimed all workstreams; beginning journal schema, device-local index relocation, divergence recovery, lifecycle wiring, tests, and docs.
- Evidence: Spec 031 device-local patterns and archived 019/002 session index behavior.
- Remaining: Implement WS-01 through WS-05 end to end.
- Blockers: None.
- Next action: Land journal + index location contracts, then recovery classification and startup reconciliation.

### 2026-07-23 — session-cloud-recovery — completed WS-01–WS-05

- Changed: Implemented device-local journal (`pivi.session-journal.v1`), device-local index root, divergence classification/recovery, startup/unload wiring, focused fault-matrix tests, full-locale i18n, and documentation sync.
- Evidence: Unit fault matrix green; typecheck/lint/boundaries/build green; existing session suites green.
- Remaining: Optional live iCloud vault observation after reload.
- Blockers: None for closeout.
- Next action: Archive spec; hand remaining release assurance to spec `036`.

## Completion summary

Session cloud recovery is implemented. Locally completed JSONL continuations are sealed into a vault-scoped device-local write-ahead journal and confirmed after successful append. Rebuildable indexes no longer live beside synced `.pivi/sessions` files. Startup reconciliation detects replacement, inode change, truncation, rollback, fingerprint divergence, interrupted append, and unacknowledged entries; it never overwrites an externally changed source and never discards a locally completed turn. Non-append-compatible divergence creates an explicit recovered session with visible provenance and idempotent divergence identity. Unload remains best-effort while leaving journal/source state for deterministic next-startup recovery. The live stale-write guard, title metadata, compaction checkpoints, subagent reports, and Pi JSONL compatibility remain intact.
