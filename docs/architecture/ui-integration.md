# UI integration

## Purpose

Bind Obsidian views, modals, and settings to core ports without importing Pi.

## Responsibilities

- `ObsiusView` / `TabManager` — chat tabs, service lifecycle.
- `InputController` — send, queue, built-ins (`/mcp-auth`), approvals.
- `MessageRenderer` / tool renderers — stream display.
- `ObsiusSettings` — providers, MCP list, env snippets.
- `InlineEditModal` — selection-based edit via auxiliary service.

## Non-responsibilities

- Agent loop implementation.
- MCP wire protocol.

## Interfaces

Features use:

- `AgentWorkspace.getMcpServerManager()`, `getMcpOAuth()`
- `ChatRuntime` from tab service
- `RuntimeCapabilities` for feature flags

## Design

Strict import rule: `src/features/**` → `src/core/**` only. Bootstrap in `main.ts` wires `piWorkspaceRegistration`. MCP toolbar and mention dropdown gated on `supportsMcpTools`.

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Runtime not ready | `ensureServiceInitialized` + notices |

## Related ADRs

- [ADR-0002](../adr/0002-hexagonal-ports-and-adapters.md)
