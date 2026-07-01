# Core boundary governance spec

## Status

Superseded as a hexagonal-runtime governance baseline. The remaining durable rule is narrower: keep `src/core/**` pure when it contains reusable prompt/domain helpers, but do not preserve a `features → core ← pi` runtime seam for its own sake.

## Problem

`src/core/` used to be Pivi's hexagonal inner layer. Pivi is now Pi-only, so core should be treated as a home for pure helpers, shared DTOs, and domain logic that are genuinely easier to test outside UI/runtime modules. Broad runtime ports and registration buckets should move out or disappear.

## Boundary rules

`src/core/**` must not import:

- `src/main.ts` / `PiviPlugin`
- `src/pi/**`
- `src/features/**`
- `obsidian` or Obsidian UI/runtime classes
- `@modelcontextprotocol/sdk/**`
- `@earendil-works/pi-*` packages

Core may keep:

- framework-neutral DTOs and domain types
- small interfaces such as `FileStore` / `SharedAppStorage` when they isolate real I/O
- pure parsing/classification helpers that do not create network, child-process, Obsidian, or Pi SDK objects

Concrete implementations belong in:

- `src/app/**` for Obsidian host/app storage and lifecycle adapters
- `src/pi/**` for Pi runtime, Pi settings, MCP SDK transports, OAuth, session persistence, and tool registry modules
- `src/features/**` for UI orchestration; feature code may consume Pi product services directly

## Enforcement

`eslint.config.mjs` contains a `no-restricted-imports` block for `src/core/**/*.ts` that rejects host, adapter, and SDK imports. Keep that rule while core still contains pure helpers. This rule governs core purity only; feature code can use Pivi-owned `src/pi/**` product modules when that is the simpler path.

## Host context

`AgentHostContext` is a small host/settings context shape for code that must remain pure. Prefer plugin-owned Pi services and explicit constructor parameters over adding new raw-host assumptions.

## File storage

Core owns only the `FileStore` / `HomeFileStore` ports. Obsidian vault IO is implemented by `src/app/storage/ObsidianVaultFileAdapter.ts`; home-directory IO is implemented by `src/app/storage/HomeFileAdapter.ts`.

## MCP testing

Pure MCP config parsing and test result DTOs may stay in core. Concrete MCP client transports and SDK usage live under `src/pi/mcp/`. Settings UI should move toward direct `PiWorkspaceServices` access instead of generic workspace ports.

## Environment scopes

Environment scopes should use product language (`shared` and `pi`) once the settings migration is simplified. Legacy scope normalization may remain only as long as existing persisted data requires it.
