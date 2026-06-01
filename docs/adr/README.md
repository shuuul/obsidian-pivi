# Architecture Decision Records (ADR)

Append-only decision log. When a decision changes, add a new ADR that **supersedes** the old one (update `Status` on the old file to `Superseded by ADR-00XX`).

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](./0002-hexagonal-ports-and-adapters.md) | Hexagonal ports and adapters | Accepted |
| [0003](./0003-pi-as-sole-agent-runtime.md) | Pi as sole agent runtime | Accepted |
| [0004](./0004-vault-local-mcp-config.md) | Vault-local MCP configuration | Accepted |
| [0005](./0005-mcp-mention-transform.md) | MCP mention transform in turn prompt | Accepted |
| [0006](./0006-mcp-proxy-tool.md) | MCP proxy tool vs direct registration | Accepted |
| [0007](./0007-markdown-design-source-of-truth.md) | Markdown in repo as design source of truth | Accepted |
| [0008](./0008-pi-only-layered-architecture.md) | Pi-only layered architecture (simplified hexagonal) | Accepted |
| [0009](./0009-obsidian-native-tools.md) | Obsidian-native tools and hybrid CLI transport | Accepted |
| [0010](./0010-jsonl-session-tree-and-obsius-storage.md) | JSONL session tree and unified `.obsius/` vault storage | Accepted |

New ADR: copy [_template.md](./_template.md), use next number, add row above.
