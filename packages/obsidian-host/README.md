# @pivi/obsidian-host

## Purpose

Obsidian host adapters and platform services: vault API wrapper, file stores, shared plugin storage, settings persistence, keychain access types, CLI transport, and vault/path helpers.

## Allowed dependencies

- Obsidian public API types/runtime imports.
- Node `fs`/`path` and process helpers for local file adapters and CLI discovery.
- `@pivi/pivi-agent-core/foundation` contracts.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- `@pivi/pivi-agent-core/engine/pi`, `@pivi/pivi-agent-core/skills`, or concrete Obsidian tool implementations; app composition injects product/runtime settings semantics through storage codecs.
- Obsidian UI package imports.
- Pi engine construction or Agent lifecycle imports.
- Concrete Obsidian tool specification imports.

## Public API

- `ObsidianVaultApi`, `ObsidianVaultFileAdapter`, `HomeFileAdapter`, `SharedStorageService`, `PiviSettingsStorage` codec/persistence contracts, `ObsidianCliTransport`, vault path utilities, and host service interfaces. File-store port types are defined by `@pivi/pivi-agent-core/ports`.
- Exported through `@pivi/obsidian-host` and `@pivi/obsidian-host/*`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
