# @pivi/obsidian-host package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-host` is the Obsidian/Electron host adapter layer. It wraps vault APIs, file stores, settings persistence, shared storage, secret storage, host context, path normalization, and renderer compatibility helpers.

## Public entrypoints

- `src/index.ts` re-exports the package surface. Add new intentional host APIs here.
- `src/obsidianVaultApi.ts` wraps Obsidian `App` vault operations: note reads/writes/edits, file resolution, tree/list, move/trash/folder creation, open-in-leaf, scan-based search, note info, links, backlinks, tag/graph analysis, base-file/view inspection, recent files, attachment metadata, and binary attachment creation with Obsidian markdown links. Base lookup uses direct path/metadata resolution, and unresolved-only graph analysis reads metadata without enumerating files. Mutating note operations best-effort call `fileRecoverySnapshot.ts` to `forceAdd` the current content into Obsidian File Recovery before `vault.process` / `processFrontMatter`; unavailable File Recovery is a silent no-op, while capture failures are logged and never block writes.
- `src/fileRecoverySnapshot.ts` resolves the enabled `file-recovery` internal plugin, exposes its availability to app composition, and calls private `forceAdd(path, content)` for `.md` / `.canvas` files before Pivi vault mutations. App composition uses that availability to bypass vault-mutation approval while recovery is active.
- `src/externalFileApi.ts` wraps Node.js `fs` for reading and listing files outside the Obsidian vault by absolute path. It enforces allowed-directory realpath containment and is the host-neutral filesystem adapter consumed by external read/list tools.
- File-store contracts now live in `@pivi/pivi-agent-core/ports`; this package implements host adapters for those ports.
- Domain service contracts live with their owning `@pivi/pivi-agent-core` modules; app workspace initialization remains an app-composition contract.
- `src/bootstrap/` defines host context, app storage, and tab manager state contracts.
- `src/storage/` implements vault file, home file, and shared app storage adapters. Product settings normalization is injected by the app composition layer.
- `src/settings/` owns vault settings persistence and the codec contract used to inject product/runtime normalization plus an optional pre-save projection. Product defaults live in `@pivi/pivi-agent-core/foundation`; Pi-specific normalization and device-local-field stripping live outside this package. App composition injects `createPiviSettingsCodec`, which may commit device-local provider and environment state in `prepareForSave` before writing stripped `PersistedPiviSettings` (`VaultPersistedPiviSettings`); `SharedStorageService.savePiviSettings` surfaces synced write failures with a localized Notice while preserving committed local authority. Settings load/save use `@pivi/pivi-agent-core/foundation/configPublication` for corrupt-source preservation (`.corrupt-*` artifacts), parse diagnostics, serialized per-path saves, and atomic replacement when the file store supports rename. Runtime load still uses the full `PiviSettings` bag (`StoredPiviSettings`).
- `src/path/` owns filesystem/vault path normalization and safety helpers. `normalizePathForVault` remains the read/display helper and may return an external/absolute path when input is outside the vault. Mutating vault operations must call `requireVaultRelativeMutationPath`, which fails loudly on empty paths, absolute/drive/UNC forms, traversal, NUL, and symlink-parent escape (using nearest-existing-ancestor realpath containment).
- `src/authContextHost.ts` adapts the canonical auth context host port to system environment variables, filesystem existence checks, and home-directory lookup for Pi auth resolution.
- `src/providerLegacyAuthStore.ts` adapts the canonical provider legacy auth store port to the vault-local `.pivi/auth.json` file used only for old Codex credential migration.
- `src/scopedHttpClient.ts` implements the streaming scoped HTTP client (deadlines, encoded/decoded byte limits, content types, redirects, DNS pin) over `@pivi/pivi-agent-core/network` policy. `src/createPiviNetworkClients.ts` builds purpose-scoped clients (`provider`, `mcp`, `web-search`, `web-fetch`, `image`, `skills`, connectivity) and a shared `OriginGrantRegistry` for short-lived private-origin exceptions. `src/bundledFetch.ts` is esbuild-injected so free `fetch` identifiers resolve to the scoped provider client without assigning `window.fetch`. `src/nodeFetch.ts` remains a legacy export surface over scoped fetch; do not reintroduce global fetch patching. `src/obsidianHttpClient.ts` adapts scoped clients to the `HttpClient` port. `src/electronCompat.ts` and `src/systemProcessRunner.ts` cover other renderer/Electron compatibility gaps; `systemProcessRunner` is the bounded process primitive: required byte limits/timeout/cwd/shell policy, streaming truncation metadata, AbortSignal, process-tree termination with forced-kill escalation, and termination-kind results (exit/signal/timeout/abort/spawn-error/forced-kill). Shell is forbidden unless a reviewed adapter declares an explicit reason (for example Windows `.cmd`).
- `src/cli/obsidianCliTransport.ts` executes the official Obsidian CLI through the injected `ProcessRunner` with vault cwd policy rather than a private unbounded spawn.
- `styles/pivi-theme.css` maps Obsidian theme variables into the `--pivi-host-*` contract consumed by `@pivi/pivi-react`; the root CSS build prepends it directly before the React style manifest. It is a build input, not a JavaScript package export.

## Boundaries

- This package may import Obsidian API types, Electron/renderer globals, and Node platform modules needed for host adaptation.
- Implement host adapters against `@pivi/pivi-agent-core/ports` (file stores, secrets, HTTP, process, openers). App composition injects those adapters into the Pi engine; the engine must not import this package.
- Do not import UI components or Pi engine implementation details. Expose host capabilities through typed contracts.
- Do not import `@pivi/pivi-agent-core/engine/pi`, `@pivi/pivi-agent-core/skills`, `@pivi/pivi-agent-core/tools`, or concrete Obsidian tool implementations; app composition and tool packages should add product/runtime/tool semantics above the host layer.
- Keep path validation and vault containment checks here when they protect host file operations.
- Preserve explicit errors for missing vault paths, unsafe paths, storage failures, and unsupported host operations.
- Obsidian public API is preferred for vault operations; CLI is only for capabilities the public API cannot provide.

## Package map

- `package.json` exports the barrel and explicit leaf subpaths (`authContextHost`, `bootstrap/*`, `bundledFetch`, `cli/*`, `createPiviNetworkClients`, `electronCompat`, `externalFileApi`, `nodeFetch`, `obsidianHttpClient`, `openExternalUrl`, `path`, `providerLegacyAuthStore`, `scopedHttpClient`, `settings/piviSettingsStorage`, `storage/sharedStorageService`, `systemProcessRunner`). Add new intentional host APIs to `src/index.ts` and the matching export entry.
- There is no package-local build step; source is consumed by the root build.
- There is no package-local typecheck script. Verify host changes with the root typecheck and targeted tests for affected tools/runtime/UI.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
