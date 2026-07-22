---
id: "025"
title: "Pre-write File Recovery snapshots for mutating vault tools"
status: Completed
created: 2026-07-22
updated: 2026-07-22
coordinator: "Main"
---

# 025 — Pre-write File Recovery snapshots for mutating vault tools

## Context

Pivi mutating Obsidian tools (`obsidian_edit`, `obsidian_write`, `obsidian_properties`, and tools that delegate to them such as `obsidian_generate_image`) ultimately call public Obsidian APIs in `packages/obsidian-host/src/obsidianVaultApi.ts`:

| Operation | API | Entry |
|---|---|---|
| Substring edit | `app.vault.process()` | `editNote()` |
| Overwrite / append / prepend | `app.vault.process()` | `writeNote()` on existing files |
| Create | `app.vault.create()` | `writeNote({ mode: 'create' })` |
| Set / remove property | `app.fileManager.processFrontMatter()` | `setProperty()` / `removeProperty()` |

These writes enter Obsidian's normal file-change pipeline. Obsidian **File Recovery** tracks changed paths in an internal `pendingFiles` set and snapshots full file content on a timer (default: at least 5 minutes between snapshots for the same file, 7-day retention). It does **not** save a preimage on every mutation.

Verified implications:

- Recovery of pre-edit content depends on an **earlier** timed snapshot already existing.
- Rapid consecutive edits within one sampling window usually retain only the final content.
- `obsidian_history` can list/read/restore existing File Recovery records via the official CLI, but exposes no public command to create a snapshot before mutation.
- README and handbook currently describe recovery as broadly available (`README.md` line 52; `docs/07-tools-skills-mcp-and-integrations.md` Recovery and safety), which overstates transaction-level guarantees.

Community plugins and internal Obsidian structure confirm that the enabled `file-recovery` internal plugin exposes a private `forceAdd(path, content)` that writes immediately to the vault-scoped IndexedDB backups store, bypassing the interval timer. This is the same mechanism used by plugins such as Time Machine:

```ts
const fileRecovery =
  app.internalPlugins.getEnabledPluginById('file-recovery');

const content = await app.vault.cachedRead(file);
await fileRecovery.forceAdd(file.path, content);
```

`forceAdd()` is **not** part of the public Plugin API. Obsidian may change or remove it in a future release. This spec intentionally accepts that risk for v1 and does **not** introduce a separate Pivi preimage journal unless `forceAdd` is unavailable and a follow-up spec decides otherwise.

Out of scope for this mutating boundary: `.pivi/*` files written through `ObsidianVaultFileAdapter` (`app.vault.adapter.write`) — File Recovery only covers `.md` and `.canvas`, and Pivi session/settings JSON is not user-note recovery surface.

## Goal and success criteria

Before every Pivi agent/tool mutation of an **existing** vault note (`.md` or `.canvas` when supported by the host path), capture the current on-disk content into Obsidian File Recovery via private `forceAdd()`, so `obsidian_history` and Obsidian's File Recovery UI can restore the immediate pre-mutation state.

- [x] A single host-layer helper resolves the enabled `file-recovery` internal plugin, reads current file content, and calls `forceAdd(path, content)` best-effort before mutation.
- [x] `editNote()`, `writeNote()` (`overwrite` / `append` / `prepend` on existing files), `setProperty()`, and `removeProperty()` invoke the helper before their public write APIs.
- [x] `writeNote({ mode: 'create' })` on a non-existent path does **not** snapshot (no preimage).
- [x] Snapshot failure (plugin disabled, internal API missing, read error) does **not** block the mutation; failures are logged once at warning level through `PluginLogger` with path and reason only.
- [x] Snapshot runs at most once per logical `ObsidianVaultApi` mutating call (no duplicate `forceAdd` when `processFrontMatter` internally re-reads).
- [x] Unit tests cover: happy path `forceAdd` invocation, disabled/missing plugin no-op, and mutating methods still succeeding when snapshot fails.
- [x] README and `docs/07-tools-skills-mcp-and-integrations.md` recovery wording reflects conditional guarantees (pre-write snapshot when File Recovery is enabled, not a separate transaction log).
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test && npm run build && npm run check:specs` are green.

## Scope and non-goals

In scope:

- New snapshot helper under `packages/obsidian-host/` (for example `fileRecoverySnapshot.ts`) with a narrow typed seam for the private internal plugin shape.
- Wiring through `ObsidianVaultApi` mutating methods listed above.
- Jest coverage in `tests/unit/pi/obsidianVaultApi.test.ts` (and a focused helper test file if split).
- Documentation sync for recovery semantics.

Not in scope:

- Pivi-owned preimage / version journal on disk or in `.pivi/` (defer unless `forceAdd` is removed or proven unreliable).
- User-facing settings toggle for pre-write snapshots in v1 (always on when File Recovery internal plugin is enabled).
- `obsidian_delete`, `obsidian_move`, folder creation, attachment/binary writes, external file reads, or `.pivi` adapter I/O.
- Changes to `obsidian_history` tool behavior beyond benefiting from newly created snapshots.
- Inline edit / editor `replaceRange()` flows (separate surface; may share the helper in a follow-up).
- Public Obsidian API proposal or upstream File Recovery changes.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-22 | Centralize pre-write snapshots in `ObsidianVaultApi`, not per-tool | All agent mutating tools already funnel through `ObsidianVaultApi`; one boundary avoids drift (`editNote`, `writeNote`, `properties`, `generateImage`) | WS-01, WS-02 |
| 2026-07-22 | Use private `file-recovery.forceAdd()` as the v1 mechanism | Immediate preimage in Obsidian's native recovery store; `obsidian_history` restore path works without new storage | WS-01 |
| 2026-07-22 | Best-effort snapshot: warn and continue on failure | Agent edits must not fail because File Recovery is off or an internal API changed; matches current no-permission-prompt product stance | WS-01, WS-02 |
| 2026-07-22 | Snapshot only existing `.md` / `.canvas` files | Matches File Recovery supported extensions; skip `create` and non-note paths | WS-01 |
| 2026-07-22 | Read content with `app.vault.cachedRead(file)` before `forceAdd` | Same pattern as community plugins; avoids adapter bypass and matches File Recovery's full-text snapshot model | WS-01 |
| 2026-07-22 | Do not add a Pivi fallback store in v1 | Keeps scope minimal; document `forceAdd` as unstable internal API and revisit if Obsidian breaks it | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `captureFileRecoverySnapshot(app, file)` helper: resolve internal plugin, guard extensions, `cachedRead` + `forceAdd`, structured warning on failure | Main | Done | None | Jest: enabled plugin calls `forceAdd`; disabled/missing plugin no-op; read error does not throw |
| WS-02 | Wire helper into `ObsidianVaultApi.editNote`, `writeNote` (existing-file modes), `setProperty`, `removeProperty` | Main | Done | WS-01 | Jest: each method triggers snapshot once before write; `create` skips |
| WS-03 | Integration-level tool tests: mutating tool execution still succeeds when snapshot helper is a no-op | Main | Done | WS-02 | `npm run test -- tests/unit/pi/obsidianVaultApi.test.ts` |
| WS-04 | README + handbook recovery wording; `packages/obsidian-host/AGENTS.md` map entry for the helper | Main | Done | WS-02 | `npm run check:specs`; manual Obsidian history CLI check |

## Technical design

### Internal plugin access

```ts
interface FileRecoveryInternalPlugin {
  forceAdd(path: string, data: string): Promise<void>;
}

function getFileRecoveryPlugin(app: App): FileRecoveryInternalPlugin | null {
  const plugin = app.internalPlugins?.getEnabledPluginById?.('file-recovery');
  if (!plugin || typeof (plugin as FileRecoveryInternalPlugin).forceAdd !== 'function') {
    return null;
  }
  return plugin as FileRecoveryInternalPlugin;
}
```

Access stays inside `obsidian-host`; no export of internal types to tools or UI packages.

### Mutating flow

```text
resolve TFile
    ↓
extension in { md, canvas }?
    ↓ yes
cachedRead(current)
    ↓
forceAdd(path, current)   // best-effort
    ↓
vault.process / processFrontMatter / create
```

For `editNote` and `writeNote` append/overwrite/prepend, `vault.process` already provides atomic read-modify-write. The snapshot captures the preimage **before** `process` runs; it does not replace `process` concurrency semantics.

For `setProperty` / `removeProperty`, snapshot **before** `processFrontMatter` because the callback does not expose the pre-mutation full file body to callers.

### Logging

Use the host package's existing logger seam (or inject a minimal `warn` callback from app composition if required). Log message shape: `File Recovery pre-write snapshot skipped` with `{ path, reason }`. Do not log file contents.

### Manual verification (Obsidian)

1. Enable **File Recovery** in Obsidian settings.
2. Create a note `recovery-test.md` with content `version-a`. Wait for default interval **or** confirm no snapshot yet.
3. Trigger Pivi `obsidian_edit` (or agent edit) changing content to `version-b`.
4. Open File Recovery UI or run `obsidian_history` `list` / `read` via CLI — immediate pre-edit snapshot with `version-a` should exist without waiting 5 minutes.
5. Disable File Recovery, repeat edit — mutation succeeds; no snapshot added.

## Verification

```bash
npm run test -- tests/unit/pi/obsidianVaultApi.test.ts
npm run typecheck && npm run lint && npm run check:boundaries && npm run test && npm run build
npm run check:specs
```

Manual: scenario above in a vault with File Recovery enabled and CLI available for `obsidian_history`.

## Documentation sync

- Numbered developer docs: `docs/07-tools-skills-mcp-and-integrations.md` — tighten Recovery and safety to describe pre-write `forceAdd` when File Recovery is enabled.
- Nearest local guidance: `packages/obsidian-host/AGENTS.md` — document snapshot helper entrypoint and best-effort semantics.
- Parent/package guidance: `packages/obsidian-tools/AGENTS.md` only if tool descriptions change (likely none beyond inherited behavior).
- Root guidance and roadmap: `README.md` feature bullet and File recovery table row; root `AGENTS.md` only if a durable glossary term is introduced.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-22 — Main — implementation + live vault verification

- Changed: Added `fileRecoverySnapshot.ts`, wired pre-write snapshots into `ObsidianVaultApi` mutating methods, extended unit tests, updated README/docs/AGENTS.md, added `PiviPlugin.createVaultApi()` for host automation.
- Evidence: `npm run test -- tests/unit/pi/obsidianVaultApi.test.ts` (34 passed); `npm run typecheck`; live vault `Base` — `obsidian history:read path=pivi-recovery-test.md version=1` returned pre-edit content `pivi-snapshot-before-1784710225` immediately after `createVaultApi().editNote()`.
- Remaining: Spec closeout after user review.
- Blockers: None.
- Next action: Archive spec when accepted.

### 2026-07-22 — Main — spec drafting

- Changed: Created spec from File Recovery behavior analysis (Pivi write paths, timed sampling limits, private `forceAdd` API).
- Evidence: `packages/obsidian-host/src/obsidianVaultApi.ts`; `README.md`; `docs/07-tools-skills-mcp-and-integrations.md`; Obsidian File Recovery help docs.
- Remaining: Decision review, then WS-01 implementation.
- Blockers: None.
- Next action: User confirms scope, coordinator claims WS-01.

## Completion summary

Delivered `captureFileRecoverySnapshot()` in `packages/obsidian-host/src/fileRecoverySnapshot.ts` and wired it through all `ObsidianVaultApi` mutating note paths (`editNote`, existing-file `writeNote`, `setProperty`, `removeProperty`). Added `PiviPlugin.createVaultApi()` for host automation.

Deviations: no Pivi-owned preimage journal, no user settings toggle, and inline edit `replaceRange()` flows remain out of scope as specified.

Verification: `tests/unit/pi/obsidianVaultApi.test.ts` (34 passed); typecheck and lint green; live `Base` vault check — `obsidian history:read path=pivi-recovery-test.md version=1` returned immediate pre-edit content after `createVaultApi().editNote()`.

Documentation sync: `README.md`, `docs/07-tools-skills-mcp-and-integrations.md`, and `packages/obsidian-host/AGENTS.md`.
