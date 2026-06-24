# MCP integration spec

## Problem

Users need vault-scoped MCP servers inside Obsidian with mentions, OAuth, and settings UI—without relying on global desktop MCP configs.

## Goals

- Register servers in `.obsius/mcp.json` (stdio, http, sse).
- **MCP mention:** `@name` in UI → `@name MCP` in API prompt.
- Proxy tool `mcp` for list/describe/call.
- OAuth: vault storage, `/mcp-auth`, settings authenticate/logout.
- Context-saving servers only active when mentioned or toolbar-enabled.

## Non-goals

- Global MCP config import from Cursor/VS Code.
- Full pi-mcp-adapter feature parity (TUI panel, direct tool registration).
- MCP server hosting.

## User experience

1. Settings → MCP Servers → add server.
2. Optional OAuth: Auth button or `/mcp-auth <name>`.
3. Chat: `@myserver` or enable server in toolbar.
4. Agent uses `mcp` tool to call remote tools.

## API / interfaces

| Component | Contract |
|-----------|----------|
| `AppMcpStorage` | `load` / `save` `ManagedMcpServer[]` |
| `AppMcpOAuth` | `getAuthStatus`, `authenticate`, `logout` |
| `finalizeTurnPrompt` | Mention transform + merge toolbar servers |
| `createPiMcpProxyTool` | JSON actions: status, servers, describe, call |

## Data model

- Config: `mcpServers` + `_obsius2.servers[name]` metadata (`auth`, `oauth`, `disabledTools`, …).
- OAuth: `.obsius/mcp-oauth/sha256-<hash>/tokens.json` (`tokens`, `clientInfo`, `codeVerifier`, `serverUrl`).

## Algorithm / flow

### Mention transform

```
displayPrompt:  "Summarize @github issues"
apiPrompt:      "Summarize @github MCP issues"
```

### OAuth (authorization_code)

1. `startAuth` → callback server localhost:19876.
2. Browser opens authorization URL.
3. Callback → `completeAuth` → tokens in vault.

## Evaluation

- Unit: `supportsMcpOAuth`, `finalizeTurnPrompt`, `McpVaultAuthStore`.
- Manual: AGENTS.md integration steps; verify tool call after `/mcp-auth`.
- Future harness: pair MCP mention examples with expected `displayPrompt`, `apiPrompt`, and active server/tool set so prompt changes cannot silently break context-saving behavior.

## Open questions

- Auto-auth on first tool failure (pi-mcp-adapter behavior).
- Direct tool registration threshold (tool count / model).

## Related

- [architecture/tool-system.md](../architecture/tool-system.md)
- [turn-prompt-spec.md](./turn-prompt-spec.md)
