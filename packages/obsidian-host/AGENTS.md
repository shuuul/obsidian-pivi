# @pivi/obsidian-host package guide

## Purpose

`@pivi/obsidian-host` is the Obsidian/Electron host adapter layer. It wraps vault APIs, file stores, settings persistence, shared storage, secret storage, host context, path normalization, and renderer compatibility helpers.

## Public entrypoints

- `src/index.ts` re-exports the package surface. Add new intentional host APIs here.
- `src/ObsidianHost.ts` defines the aggregate host capability bag.
- `src/ObsidianVaultApi.ts` wraps Obsidian `App` vault operations: note reads/writes/edits, file resolution, tree/list, move/trash/folder creation, open-in-leaf, scan-based search, note info, links, backlinks, and attachments.
- `src/FileStore.ts` defines vault/home file-store contracts.
- `src/serviceContracts.ts` defines app service contracts consumed by runtime and UI.
- `src/bootstrap/` defines host context, app storage, and tab manager state contracts.
- `src/storage/` implements vault file, home file, and shared app storage adapters. Product settings normalization is injected by the app composition layer.
- `src/settings/` owns vault settings persistence and the codec contract used to inject product/runtime normalization. Product defaults live in `@pivi/core`; Pi-specific normalization lives outside this package.
- `src/path/` owns filesystem/vault path normalization and safety helpers.
- `src/electronCompat.ts` and `src/nodeFetch.ts` patch renderer/Electron compatibility gaps.

## Boundaries

- This package may import Obsidian API types, Electron/renderer globals, and Node platform modules needed for host adaptation.
- Do not import UI components or Pi runtime implementation details. Expose host capabilities through typed contracts.
- Do not import `@pivi/pi-runtime`, `@pivi/skills`, `@pivi/tools`, or concrete Obsidian tool implementations; app composition and tool packages should add product/runtime/tool semantics above the host layer.
- Keep path validation and vault containment checks here when they protect host file operations.
- Preserve explicit errors for missing vault paths, unsafe paths, storage failures, and unsupported host operations.
- Obsidian public API is preferred for vault operations; CLI is only for capabilities the public API cannot provide.

## Package map

- `package.json` exports the barrel and source subpaths.
- There is no package-local build step; source is consumed by the root build.
- The package-local `typecheck` script is a placeholder. Verify host changes with root typecheck and targeted tests for affected tools/runtime/UI.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
