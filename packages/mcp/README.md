# @pivi/mcp

## Purpose

Vault-local MCP configuration, server lifecycle management, OAuth flow support, MCP proxy tool adaptation, and MCP prompt/mention helpers.

## Allowed dependencies

- `@pivi/core` contracts.
- Raw Pi SDK tool types where needed to expose MCP tools to the Pi Agent boundary.
- MCP SDK packages.
- Node networking/filesystem/path helpers used by MCP transports and OAuth callback handling.
- Obsidian host APIs only for vault-local OAuth storage and request helpers.

## Forbidden dependencies

- Obsidian UI package imports.
- Obsidian tool implementation imports.
- App composition-root imports.

## Public API

- `McpServerManager`, `PiMcpBridge`, MCP config parser/storage, OAuth services/stores/providers, connection pool, proxy tool creation, and MCP types.
- Exported through `@pivi/mcp`, `@pivi/mcp/*`, and `@pivi/mcp/oauth/*`.
