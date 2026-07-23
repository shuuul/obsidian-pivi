---
id: "037"
title: "Runtime resilience and scale"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 037 — Runtime resilience and scale

## Context

The review's remaining P2 findings concern bounded behavior under large Vaults/directories and best-effort lifecycle persistence:

- Vault text search sequentially reads/splits Markdown files without cancellation, progress, bounded concurrency, or an mtime-driven cache.
- `obsidian_list_external` returns every direct child as one JSON result without pagination or output limits.
- React stores already use granular subscriptions and virtualization, so further work needs measurements rather than a state-library rewrite.
- Obsidian unload cannot await asynchronous persistence. Current final snapshot/disposal work is best-effort, and the roadmap already calls for a device-local write-ahead journal plus explicit recovery from cloud-file replacement/rollback.

Archived specs `001`–`004` and `019` provide performance workloads and the iCloud replacement diagnostic. This final review-followup spec begins only after the security/assurance sequence, so optimization cannot bypass the new capability, audit, path, network, or persistence boundaries.

## Goal and success criteria

Keep search, external listing, streaming UI, and session persistence bounded and recoverable at realistic scale with measured evidence.

- [ ] Vault text search supports `AbortSignal`, progress, bounded concurrency, deterministic result ordering, and configurable result/output limits.
- [ ] Search caches normalized text by stable file identity plus mtime/size and invalidates through Vault metadata/file events without returning stale content.
- [ ] Tags, graph, and properties enumeration use measured short-lived/revision caches only where benchmarks show value.
- [ ] `obsidian_list_external` supports `limit`, opaque `cursor`, deterministic sort, hidden-file policy, and maximum serialized output size.
- [ ] External listing preserves realpath containment on every page and detects directory mutation between cursors explicitly.
- [ ] Search/list tool results integrate with capability/audit budgets and never materialize an unbounded intermediate solely to truncate later.
- [ ] React streaming/virtualization benchmarks use fixed fixtures and prove no regression in commits, long tasks, dropped frames, or mounted row count.
- [ ] Snapshot publication skips semantic no-op updates; development clone/freeze work is limited to paths justified by profiling.
- [ ] A device-local write-ahead journal records completed local turns before best-effort unload flush and never stores secrets or absolute external paths.
- [ ] Cloud replacement/rollback/divergence recovers into an explicit recovered session/fork without silently overwriting either source or losing a locally completed turn.
- [ ] Rebuildable JSONL sidecar indexes move out of the synced Vault and remain disposable/reconstructable.
- [ ] Plugin disable/unload terminates owned processes and flushes/reconciles all state possible within the host lifecycle, with deterministic startup recovery.

## Scope and non-goals

In scope:

- Bounded/cancellable Vault search and measured caches.
- Paginated/bounded external directory listing.
- Fixed React streaming/virtualization profiling and no-op publication improvements.
- Device-local session write-ahead journal, cloud replacement recovery, sidecar relocation, unload/startup reconciliation.
- Scale fixtures, benchmarks, fault injection, docs, and live host validation.

Not in scope:

- Replacing the current React store or virtualization library without benchmark evidence.
- Building a permanent full-text index before bounded concurrency/caching is measured.
- Fabricating one linear history from simultaneous multi-device writers; an explicit fork is acceptable.
- Weakening stale-write guards or security/capability checks for throughput.
- Syncing device-local indexes/journals.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Optimize from fixed workloads and profiler/benchmark evidence, preserving current store architecture by default. | Existing granular subscriptions are already sound; a rewrite would add risk without a measured bottleneck. | WS-03 |
| 2026-07-23 | Page and bound at the source instead of materializing complete results before truncation. | Output limits must also control memory and latency. | WS-01, WS-02 |
| 2026-07-23 | Store journals/indexes in vault-scoped device-local storage, never in synced `.pivi`. | They describe device timing and rebuildable state and can conflict under cloud sync. | WS-04 |
| 2026-07-23 | Recover divergence as an explicit new session/fork. | No silent overwrite/no local-turn loss is more truthful than guessing a merged order. | WS-04 |
| 2026-07-23 | Treat unload as best-effort and make correctness come from incremental durable state plus startup reconciliation. | Obsidian unload cannot reliably await arbitrary asynchronous work. | WS-04 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Add cancellable bounded Vault search, deterministic ordering, progress, and measured revision cache | Unassigned | Pending | Specs 034 and 036 completed | Large-Vault benchmark and stale-cache tests |
| WS-02 | Add cursor pagination, mutation detection, containment, and serialized-output limits to external listing | Unassigned | Pending | Specs 033–034 completed | Large-directory and symlink/mutation tests |
| WS-03 | Profile fixed React streaming/virtualization fixtures and remove only proven no-op/clone/freeze costs | Unassigned | Pending | Spec 036 completed | Before/after traces and regression budgets |
| WS-04 | Implement device-local session journal, sidecar relocation, cloud divergence recovery, and unload/startup reconciliation | Unassigned | Pending | Spec 036 completed; archived spec 019 evidence | Crash/cloud-replacement fault matrix |
| WS-05 | Documentation, full gates, benchmarks, real Obsidian validation, and closeout | Unassigned | Pending | WS-01–WS-04 | Reproducible evidence and runtime inspection |

## Verification

Fixed scale fixtures must record file count, total bytes, file-size distribution, directory child count, platform/filesystem, warm/cold cache, concurrency, and cancellation point. Required scenarios:

- Search cancellation before read, during read, during normalization, and during result collection.
- File change/delete/rename during search and cache reuse; deterministic results independent of completion order.
- External directory with tens of thousands of entries, hidden files, non-UTF-8 names where supported, symlinks, and mutation between pages.
- Cursor misuse with another directory/device/generation fails explicitly.
- Streaming fixtures from archived performance specs show stable mounted rows and accepted commit/long-task/frame budgets in main and pop-out owner realms.
- Completed turn followed by abrupt quit, disable, plugin reload, file replacement, inode replacement, rollback, truncation, concurrent external append, and corrupted journal/index.
- Recovery never overwrites the external source, never drops a completed local turn, labels the recovered session, and rebuilds disposable indexes.
- Owned child processes are absent after unload/reload and startup reconciliation is idempotent.

Commands:

```bash
npm run test -- --runInBand tests/unit/obsidian-tools
npm run test -- --runInBand tests/unit/pi/session
npm run test -- --runInBand tests/pivi-react
npm run test -- --runInBand tests/integration
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
npm run analyze:bundle
npm run check:bundle-size
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

Performance commands and fixture identifiers introduced during WS-01/WS-03 must be recorded with baselines in this spec before any speedup claim.

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/05-tabs-sessions-and-history.md`, `docs/06-subagents-streaming-and-rendering.md`, `docs/07-tools-skills-mcp-and-integrations.md`, `docs/10-roadmap-release-and-maintenance.md`, and `docs/11-chat-ui-evolution.md`.
- Nearest local guidance: session, tool, React store/rendering, app lifecycle, and test guidance affected by the implementation.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, `packages/obsidian-tools/AGENTS.md`, and `packages/pivi-react/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md` where user-visible limits/recovery change, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Consolidated bounded large-data behavior, measured React tuning, and the existing cloud-session/unload roadmap into the final resilience phase.
- Evidence: Current external-list tool, Vault search behavior, archived performance specs `001`–`004`, diagnostic spec `019`, and roadmap Next items.
- Remaining: Complete hardening/assurance prerequisites, define fixed scale fixtures, and execute WS-01 through WS-05.
- Blockers: Capability/audit budgets and platform test infrastructure from specs `034` and `036` must be stable.
- Next action: After prerequisites, make this spec Active and capture baselines before changing algorithms.

## Completion summary

Pending.
