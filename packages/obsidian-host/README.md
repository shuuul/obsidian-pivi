# @pivi/obsidian-host

## Purpose

Obsidian host adapters and platform services: vault API wrapper, file stores, shared plugin storage, settings persistence, keychain access types, CLI transport, process runner, and vault/path helpers.

## Allowed dependencies

- Obsidian public API types/runtime imports.
- Node `fs`/`path` and process helpers for local file adapters and CLI discovery.
- Host-neutral contracts/defaults from `@pivi/pivi-agent-core/foundation`, `@pivi/pivi-agent-core/ports`, `@pivi/pivi-agent-core/session`, and `@pivi/pivi-agent-core/auth`.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- `@pivi/pivi-agent-core/engine/pi`, `@pivi/pivi-agent-core/skills`, or concrete Obsidian tool implementations; app composition injects product/runtime settings semantics through storage codecs.
- `@pivi/obsidian-react` imports.
- Pi engine construction or Agent lifecycle imports.
- Concrete Obsidian tool specification imports.
- Being imported by `@pivi/pivi-agent-core/engine/pi` (host adapters are injected via `ports` by app composition).

## Public API

- `ObsidianVaultApi`, `ExternalFileApi`, `ObsidianVaultFileAdapter`, `HomeFileAdapter`, `SharedStorageService`, `PiviSettingsStorage` codec/persistence contracts, `ObsidianCliTransport`, `systemProcessRunner`, and vault/path utilities. Domain service and file-store/HTTP/process/opener contracts are defined by their owning `@pivi/pivi-agent-core` modules.
- Exported through `@pivi/obsidian-host` and `@pivi/obsidian-host/*`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
