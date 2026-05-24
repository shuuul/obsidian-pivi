# ADR-0001: Record architecture decisions

## Status

Accepted

## Context

Obsius integrates Pi, MCP SDK, and Obsidian. Design rationale was scattered across commits, prompts, and adaptor code. Future contributors need to know **why** boundaries exist, not only **what** the code does.

## Decision

Maintain ADRs under `docs/adr/` using the template in `_template.md`. Significant architectural choices require a new ADR; supersede rather than silently rewrite.

## Rationale

ADRs are short, reviewable, and versioned with code. They complement architecture module docs (stable interfaces) and specs (feature detail).

## Alternatives

1. **Wiki only (Notion/Obsidian)** — drifts from code; no PR linkage.
2. **Comments only** — hard to discover; no decision history.
3. **Single ARCHITECTURE.md** — becomes stale and too long.

## Consequences

- **Positive:** Traceable framework tradeoffs; easier MCP/OAuth/runtime changes.
- **Negative:** Discipline required on PRs.
- **Debt:** Older decisions predating ADRs are captured starting ADR-0002+.

## Review date

2027-01-01
