# ADR-0007: Markdown in repo as design source of truth

## Status

Accepted

## Context

Design knowledge was split across AGENTS.md, chat history, and code. External notes (Obsidian, Heptabase) are good for thinking but poor for version alignment with PRs.

## Decision

- Canonical structure: `docs/` (overview, architecture, adr, specs, notes, diagrams).
- `AGENTS.md` remains the **operational** entry (build, test, lint) and links to `docs/`.
- Stable conclusions migrate from `docs/notes/` → architecture or ADR.

## Rationale

Docs diff with code; reviewers see design + implementation together; ADRs answer “why” years later.

## Alternatives

1. **Notion-only** — no git linkage.
2. **AGENTS.md only** — already overloaded; mixes how-to with why.

## Consequences

- **Positive:** Decision asset, not just description.
- **Negative:** Maintenance discipline on PRs.
- **Debt:** Backfill notes for Pi version quirks over time.

## Review date

2027-01-01
