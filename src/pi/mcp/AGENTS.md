# `src/pi/mcp/` — Pi MCP bridge, proxy tool, and OAuth storage

Adaptor layer that turns core MCP settings/mentions into Pi tool execution through a single MCP proxy tool and connection pool.

## Rules

- `PiMcpBridge` owns active mentions and toolbar-enabled server state for runtime calls.
- `createPiMcpProxyTool` exposes MCP to the Pi agent as one tool surface.
- Vault-local MCP paths live here; do not write global host MCP config.
- OAuth implementation details belong in `oauth/`.
