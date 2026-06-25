# Specs docs guidance

Scope: files under `docs/specs/`.

## Purpose

Specs describe **feature-level contracts**: problem, goals, non-goals, user experience, interfaces, data model, algorithm/flow, and evaluation.

## What belongs here

- Requirements and acceptance criteria for medium+ features.
- Prompt formats, storage schemas, API/interface shapes, and migration flows tied to a feature.
- Rejected/deferred designs when they prevent future confusion.
- Future work or open questions for that specific feature.

## What does not belong here

- Stable module-wide architecture; promote that to `docs/architecture/`.
- Historical-only audits, bundle snapshots, dependency migration notes, or experiment logs; put those in `docs/notes/`.
- General project backlog/TODO lists.

## Cross-linking rules

- Specs should link back to the relevant `../architecture/...` doc so readers understand the owning system seam.
- Specs may link to other specs when flows overlap.
- Avoid depending on `../notes/...`; if historical context matters, summarize the durable decision in the spec and keep the note as optional background.
- When implementation diverges from an older design, update the spec status and either rewrite the body to current behavior or move old material into a “Rejected / deferred designs” section.
