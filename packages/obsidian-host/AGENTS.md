# @pivi/obsidian-host package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/obsidian-host` is the Obsidian/Electron host adapter layer. It wraps vault APIs, file stores, settings persistence, shared storage, secret storage, host context, path normalization, and renderer compatibility helpers.

## Public entrypoints

- `src/index.ts` re-exports the package surface. Add new intentional host APIs here.
- `src/obsidianVaultApi.ts` wraps Obsidian `App` vault operations: note reads/writes/edits, file resolution, tree/list, move/trash/folder creation, open-in-leaf, scan-based search, note info, links, backlinks, tag/graph analysis, base-file/view inspection, recent files, attachment metadata, and binary attachment creation with Obsidian markdown links. Base lookup uses direct path/metadata resolution, and unresolved-only graph analysis reads metadata without enumerating files.
- `src/externalFileApi.ts` wraps Node.js `fs` for reading and listing files outside the Obsidian vault by absolute path. It enforces allowed-directory realpath containment and is the host-neutral filesystem adapter consumed by external read/list tools.
- File-store contracts now live in `@pivi/pivi-agent-core/ports`; this package implements host adapters for those ports.
- Domain service contracts live with their owning `@pivi/pivi-agent-core` modules; app workspace initialization remains an app-composition contract.
- `src/bootstrap/` defines host context, app storage, and tab manager state contracts.
- `src/storage/` implements vault file, home file, and shared app storage adapters. Product settings normalization is injected by the app composition layer.
- `src/settings/` owns vault settings persistence and the codec contract used to inject product/runtime normalization plus an optional pre-save projection. Product defaults live in `@pivi/pivi-agent-core/foundation`; Pi-specific normalization and device-local-field stripping live outside this package.
- `src/path/` owns filesystem/vault path normalization and safety helpers.
- `src/authContextHost.ts` adapts the canonical auth context host port to system environment variables, filesystem existence checks, and home-directory lookup for Pi auth resolution.
- `src/providerLegacyAuthStore.ts` adapts the canonical provider legacy auth store port to the vault-local `.pivi/auth.json` file used only for old Codex credential migration.
- `src/electronCompat.ts`, `src/nodeFetch.ts`, `src/obsidianHttpClient.ts`, and `src/systemProcessRunner.ts` patch renderer/Electron compatibility gaps; `nodeFetch`, `obsidianHttpClient`, and `systemProcessRunner` are the concrete Obsidian/Electron network/process implementations injected into Pi/MCP/skills runtime seams by app composition.
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

- `package.json` exports the barrel and explicit leaf subpaths (`authContextHost`, `bootstrap/*`, `cli/*`, `electronCompat`, `externalFileApi`, `nodeFetch`, `obsidianHttpClient`, `openExternalUrl`, `path`, `providerLegacyAuthStore`, `settings/piviSettingsStorage`, `storage/sharedStorageService`, `systemProcessRunner`). Add new intentional host APIs to `src/index.ts` and the matching export entry.
- There is no package-local build step; source is consumed by the root build.
- There is no package-local typecheck script. Verify host changes with the root typecheck and targeted tests for affected tools/runtime/UI.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
