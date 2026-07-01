# Architecture docs guidance

Scope: files under `docs/architecture/`.

## Purpose

Architecture docs describe **current stable system facts**: module boundaries, responsibilities, dependency direction, owned artifacts, product service boundaries, and failure modes.

## What belongs here

- Current module contracts and stable behavior.
- Cross-module seams that affect future implementation choices.
- Dependency boundaries, ownership, and allowed/forbidden imports.
- Links to feature specs for detailed flows, data shapes, or acceptance criteria.

## What does not belong here

- Historical audit details, migration logs, experiments, or old measurements; put those in `docs/notes/`.
- Feature-level PRD detail; put that in `docs/specs/` and link to it.
- Catch-all TODO lists. Put open quality work in `docs/quality-review.md` or the relevant spec’s “Future work” / “Open questions”.

## Cross-linking rules

- It is expected for architecture docs to link to `../specs/...` for feature details.
- Avoid making architecture docs depend on `../notes/...`; if a note becomes normative, promote the durable conclusion here and leave the note as historical context.
- If a subsystem is not implemented, prefer documenting it briefly in `system-architecture.md` rather than creating a placeholder architecture page.
