# ADR-0002: Hexagonal ports and adapters

## Status

Accepted

## Context

The plugin must embed a capable agent stack without coupling Obsidian UI to Pi APIs. Tests and future runtimes need a stable inner core.

## Decision

- `src/core/` defines ports and types (**zero** external agent-library dependencies).
- `src/features/` uses only `core` ports.
- `src/pi/` is the Pi adaptor; `main.ts` wires registration.

## Rationale

Matches Obsidian plugin constraints: UI churn is high; agent SDK churn is high; domain rules (turn shape, MCP mentions, settings model) should stay stable.

## Alternatives

1. **Direct Pi calls from features** — fastest initially; blocks testing and Claudian-style parity work.
2. **Microservices** — invalid inside Obsidian plugin process.

## Consequences

- **Positive:** Clear seam; unit tests under `tests/unit/core/`.
- **Negative:** More boilerplate when adding capabilities.
- **Debt:** Some types still named after Claudian concepts.

## Review date

2026-12-01
