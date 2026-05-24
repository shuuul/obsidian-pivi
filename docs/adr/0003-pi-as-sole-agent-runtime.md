# ADR-0003: Pi as sole agent runtime

## Status

Accepted

## Context

Obsius targets Pi agent behavior (tools, streaming, models via pi-ai). Supporting Claude SDK / OpenAI Agents SDK in parallel would duplicate turn pipelines and UI.

## Decision

Ship **one** adaptor: `@earendil-works/pi-agent-core` via `PiChatRuntime`. `AgentServices` registers `piAgentAdaptor` only.

## Rationale

Product positioning is “Pi in Obsidian.” Single runtime simplifies MCP bridge, capabilities flags, and settings.

## Alternatives

1. **Claude Agent SDK runtime** — used by Claudian; rejected for this repo’s scope.
2. **Pluggable multi-runtime in v1** — high cost; defer until a second adaptor is required.

## Consequences

- **Positive:** Focused codebase; shared patterns with Pi ecosystem.
- **Negative:** Pi upgrades may require adaptor changes.
- **Debt:** `mainAgent` prompt still references some non-Pi tool names.

## Review date

2026-10-01 — reassess if second runtime requested.
