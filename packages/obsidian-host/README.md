# @pivi/obsidian-host

## Purpose

Obsidian host adapters and platform services: vault API wrapper, file stores, shared plugin storage, settings persistence, keychain access types, CLI transport, process runner, vault/path helpers, and the Obsidian-to-Pivi theme-token mapping.

## Allowed dependencies

- Obsidian public API types/runtime imports.
- Node platform modules required for filesystem, path/home, HTTP, event, process, and CLI adaptation.
- Host-neutral contracts/defaults from `@pivi/pivi-agent-core/foundation`, `@pivi/pivi-agent-core/ports`, `@pivi/pivi-agent-core/session`, and `@pivi/pivi-agent-core/auth`.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- `@pivi/pivi-agent-core/engine/pi`, `@pivi/pivi-agent-core/skills`, or concrete Obsidian tool implementations; app composition injects product/runtime settings semantics through storage codecs.
- `@pivi/pivi-react` imports.
- Pi engine construction or Agent lifecycle imports.
- Concrete Obsidian tool specification imports.
- Being imported by `@pivi/pivi-agent-core/engine/pi` (host adapters are injected via `ports` by app composition).

## Public API

- The package root barrel exports `ObsidianVaultApi`, `ExternalFileApi`, file/storage adapters, settings persistence, CLI transport, `createPiviNetworkClients` / `scopedHttpClient` / `bundledFetch`, compatibility `nodeFetch`, `obsidianHttpClient`, auth/legacy-auth adapters, `systemProcessRunner`, the external opener, and vault/path utilities. `package.json` also exposes curated `@pivi/obsidian-host/<leaf>` subpaths for cross-package consumers. Domain service and file-store/HTTP/process/opener contracts are defined by their owning `@pivi/pivi-agent-core` modules. Production networking uses purpose-scoped clients with egress policy; the bundle injects free `fetch` identifiers without assigning `window.fetch`.
- Base-file view lookup resolves the requested path directly; unresolved-link-only graph analysis reads `MetadataCache` without enumerating vault files. Search, tag, orphan/deadend graph, Base listing, and other inventory operations still enumerate on explicit request.
- `styles/pivi-theme.css` maps Obsidian theme variables into the `--pivi-host-*` contract; the root CSS build prepends it as a direct input, and it contains no React component rules.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
