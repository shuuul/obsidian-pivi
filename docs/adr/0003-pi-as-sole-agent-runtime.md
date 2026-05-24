# ADR-0003: Pi as sole agent runtime

## Status

Accepted

## Context

Obsius targets Pi agent behavior (tools, streaming, models via pi-ai). Supporting Claude SDK / OpenAI Agents SDK in parallel would duplicate turn pipelines and UI.

## Decision

Ship **one** runtime: `@earendil-works/pi-agent-core` via `PiChatRuntime`. `bootstrapPiAgent()` wires `AgentServices` once; no second adaptor is planned (ADR-0008).

## Rationale

Product positioning is “Pi in Obsidian.” Single runtime simplifies MCP bridge, capabilities flags, and settings.

## Alternatives

1. **Claude Agent SDK runtime** — used by Claudian; rejected for this repo’s scope.
2. **Pluggable multi-runtime in v1** — rejected (won't do per ADR-0008).

## Consequences

- **Positive:** Focused codebase; shared patterns with Pi ecosystem.
- **Negative:** Pi upgrades may require adaptor changes.
- **Debt:** `mainAgent` prompt still references some non-Pi tool names.

## Related

- [ADR-0008](./0008-pi-only-layered-architecture.md)

## Review date

2027-05-01 — only if product strategy requires a second runtime.
