# ADR-0006: MCP proxy tool vs direct registration

## Status

Accepted

## Context

MCP servers expose many tools with evolving schemas. pi-mcp-adapter supports proxy and direct modes. Obsius must run in Electron with limited tool budget and no TUI.

## Decision

Expose **one** Pi agent tool `mcp` (search, list, describe, call) backed by `PiMcpBridge` + `PiMcpConnectionPool`. Do **not** register each MCP tool as a separate Pi tool in v1.

## Rationale

- Bounded tool list for model context.
- Central place for OAuth errors and “run `/mcp-auth`” messages.
- Aligns with pi-mcp-adapter proxy pattern without bundling the full package.

## Alternatives

1. **Direct tool registration** — richer schemas; context explosion; more reload complexity.
2. **Full pi-mcp-adapter dependency** — pulls TUI/setup assumptions ill-suited to Obsidian.

## Consequences

- **Positive:** Ship MCP faster; vault OAuth integrated.
- **Negative:** Model must learn proxy actions; one extra hop for calls.
- **Debt:** Future optional `directTools` mode documented in roadmap.

## Review date

2026-11-01
