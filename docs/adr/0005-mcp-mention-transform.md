# ADR-0005: MCP mention transform in turn prompt

## Status

Accepted

## Context

Models recognize MCP servers when mentions include a clear **MCP** suffix (Claudian behavior). Users should type natural `@server` in the UI without seeing redundant suffixes.

## Decision

- UI / display prompt: keep raw `@server`.
- API prompt: `McpServerManager.transformMentions` appends ` MCP` → `@server MCP`.
- Apply in `finalizeTurnPrompt()` at runtime boundary after `buildTurnPrompt()`.

## Rationale

Single transformation point prevents drift between input, queue, and Pi runtime. Matches user expectation (“都要做 MCP mention”).

## Alternatives

1. **Transform in UI only** — easy to miss queued turns and toolbar-only enablement.
2. **Require user to type `@server MCP`** — poor UX.

## Consequences

- **Positive:** Reliable MCP tool invocation; testable in `tests/unit/core/`.
- **Negative:** Display vs API prompt divergence must stay intentional.
- **Debt:** Mention autocomplete must still list server names without suffix.

## Review date

2026-09-01
