# Tool system

## Purpose

Expose vault MCP servers and built-in behaviors to the Pi agent safely inside Obsidian.

## Responsibilities

- Vault MCP registry: `.obsius/mcp.json` via `McpStorage` / `McpServerManager`.
- Connection pool: stdio, HTTP, SSE; OAuth via `McpOAuthService`.
- **Proxy tool** `mcp`: status, list servers, describe, call.
- **Obsidian-native tools** (implemented) — hybrid Vault API + CLI in `src/pi/tools/obsidian/`; see [obsidian-tools-spec.md](../specs/obsidian-tools-spec.md).
- Built-in slash commands include chat/session/context/MCP actions such as `clear`, `add-dir`, `resume`, `fork`, `mcp-auth`, plus `/skill:<name>` entries from the vault skill catalog.

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
| Subagent (Agent/Task) | `src/pi/tools/createSubagentTool.ts` | Spawns parallel subagents for complex tasks |
| Skill tool | `src/pi/tools/createSkillTool.ts` | Loads vault skills as callable tools |
| TodoWrite | `src/core/tools/todo.ts` | Writes task checklists for the model |

## Dependencies

- `@modelcontextprotocol/sdk` (pi adaptor)
- Vault adapter for config + oauth dirs

## Design

Inspired by [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) proxy pattern, not a full package embed. Context-saving servers require `@mention` (or toolbar enable) before tools activate. OAuth uses localhost callback `19876` and vault-stored tokens.

```mermaid
flowchart LR
  UI["Chat input / toolbar"] -- "@server or enabled server" --> Manager["McpServerManager<br/>src/core/mcp"]
  Manager -- "active server list" --> Runtime["PiChatRuntime"]
  Runtime -- "single AgentTool" --> Proxy["mcp proxy tool<br/>src/pi/mcp"]
  Proxy -- "calls" --> Pool["MCP connection pool"]
  Pool -- "stdio/http/sse" --> Server["User MCP server"]
```

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

- Direct MCP tool registration mode.

## Related

- [agent-runtime.md](./agent-runtime.md)
- [../specs/mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [../specs/obsidian-tools-spec.md](../specs/obsidian-tools-spec.md)

## Related specs

- [mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [obsidian-tools-spec.md](../specs/obsidian-tools-spec.md)
- [context-layers-spec.md](../specs/context-layers-spec.md)
