# Core boundary governance spec

## Status

Implemented as an architecture-governance baseline.

## Problem

`src/core/` is Pivi's hexagonal inner layer, but it had accumulated concrete dependencies on the Obsidian plugin class, Obsidian vault adapters, and MCP SDK transports. Those imports made core contracts harder to reuse and obscured the real adapter dependency graph.

## Boundary rules

`src/core/**` must not import:

- `src/main.ts` / `PiviPlugin`
- `src/pi/**`
- `src/features/**`
- `obsidian` or Obsidian UI/runtime classes
- `@modelcontextprotocol/sdk/**`
- `@earendil-works/pi-*` packages

Core may define:

- framework-neutral DTOs and domain types
- ports such as `FileStore`, `SharedAppStorage`, MCP/tool/provider contracts, and runtime contracts
- pure parsing/classification helpers that do not create network, child-process, Obsidian, or Pi SDK objects

Concrete implementations belong in:

- `src/app/**` for Obsidian host/app storage and lifecycle adapters
- `src/pi/**` for Pi runtime, Pi settings, MCP SDK transports, OAuth, session persistence, and tool registry adapters
- `src/features/**` for UI orchestration that consumes core ports/facades

## Enforcement

`eslint.config.mjs` contains a `no-restricted-imports` block for `src/core/**/*.ts` that rejects host, adapter, and SDK imports. Treat violations as architecture regressions rather than local lint nits.

## Host context

Agent adaptors receive an `AgentHostContext` from the composition root. Core treats it as an opaque capability bag and does not inspect concrete host APIs. During migration, `rawHost` is available only for adapter-side unwrapping; new core contracts should prefer explicit ports over adding new raw-host assumptions.

## File storage

Core owns only the `FileStore` / `HomeFileStore` ports. Obsidian vault IO is implemented by `src/app/storage/ObsidianVaultFileAdapter.ts`; home-directory IO is implemented by `src/app/storage/HomeFileAdapter.ts`.

## MCP testing

Core owns MCP config parsing and test result DTOs. Concrete MCP client transports and SDK usage live under `src/pi/mcp/`. Settings UI invokes MCP verification through `AppMcpServerTester` from workspace services.

## Environment scopes

Core uses runtime-neutral scopes: `shared` and `agent`. Legacy persisted values `pi` and `provider:pi` are normalized to `agent` when loaded.
