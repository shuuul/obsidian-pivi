# @pivi/mcp package guide

## Purpose

`@pivi/mcp` owns vault-local MCP configuration, OAuth storage, MCP server management, connection pooling, tool discovery, and the Pi-facing MCP proxy tool.

## Public entrypoints

- `src/index.ts` re-exports the public MCP surface. Keep internal transport/env helpers out of the barrel unless they become intentional API.
- `src/types.ts` defines MCP server config, managed server, config file, tool, test result, and type guards.
- `src/ports.ts` defines adapter interfaces for file stores, secret storage, prepared turns, and OAuth.
- `src/paths.ts` defines `.pivi/mcp.json` and `.pivi/mcp-oauth/` paths.
- `src/McpStorage.ts` loads/saves managed servers and migrates plaintext secrets into secret storage.
- `src/McpServerManager.ts` handles enabled servers, context-saving servers, mentions, prompt transforms, and disabled tool collection.
- `src/PiMcpBridge.ts` is the top-level facade for tool specs, calls, search, and turn preparation.
- `src/PiMcpConnectionPool.ts` owns SDK connections/transports and auth injection.
- `src/createMcpProxyToolSpec.ts` exposes MCP list/search/describe/call/status through one Pivi tool.
- `src/oauth/` owns OAuth flow/provider/vault token storage.

## Boundaries

- Keep config vault-local. Do not add global host MCP configuration writes.
- File and secret persistence must go through `ports.ts` interfaces or package-owned vault auth stores, not UI or app-shell globals.
- Keep low-level MCP SDK and transport details inside this package. Consumers use `PiMcpBridge`, storage/service contracts, and exported types.
- Avoid UI imports. User prompts, modals, and settings rendering belong to UI/host packages.
- Preserve explicit failure signals for connection, auth, and tool-call errors; do not silently disable required MCP behavior.

## Package map

- `package.json` exports the barrel, source subpaths, and OAuth subpaths.
- `src/env.ts` and `src/nodeFetch.ts` are Electron/renderer support internals unless deliberately exported.
- The package-local `typecheck` script is a placeholder. Verify MCP changes with root typecheck and targeted MCP/unit tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
