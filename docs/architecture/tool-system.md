# Tool system

## Purpose

Expose vault MCP servers and built-in behaviors to the Pi agent safely inside Obsidian.

## Responsibilities

- Vault MCP registry: `.obsius/mcp.json` via `McpStorage` / `McpServerManager`.
- Connection pool: stdio, HTTP, SSE; OAuth via `McpOAuthService`.
- **Proxy tool** `mcp`: status, list servers, describe, call.
- Built-in slash commands: `clear`, `add-dir`, `resume`, `fork`, **`mcp-auth`**.

## Non-responsibilities

- Hosting MCP servers (user-provided).
- Global MCP discovery from other apps.

## Interfaces

| Port / type | Role |
|-------------|------|
| `AppMcpStorage` | Load/save server list |
| `AppMcpOAuth` | authenticate / logout / status |
| `createPiMcpProxyTool` | Agent-facing tool surface |
| `supportsMcpOAuth` | Whether server supports OAuth flow |

## Dependencies

- `@modelcontextprotocol/sdk` (pi adaptor)
- Vault adapter for config + oauth dirs

## Design

Inspired by [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) proxy pattern, not a full package embed. Context-saving servers require `@mention` (or toolbar enable) before tools activate. OAuth uses localhost callback `19876` and vault-stored tokens.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Register every MCP tool as Pi tool | Tool explosion, schema churn |
| `~/.config/mcp` | Wrong trust boundary for Obsidian vault plugin |
| Full pi-mcp-adapter bundle | Heavy; Obsidian-specific paths and UI |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| OAuth required | `/mcp-auth <server>` |
| stdio command missing | Settings test modal |
| Token expired | Settings auth badge + re-auth |

## Open questions

- Direct tool registration mode (ADR-0006 consequences).

## Related ADRs

- [ADR-0004](../adr/0004-vault-local-mcp-config.md)
- [ADR-0005](../adr/0005-mcp-mention-transform.md)
- [ADR-0006](../adr/0006-mcp-proxy-tool.md)

## Related specs

- [mcp-integration-spec.md](../specs/mcp-integration-spec.md)
