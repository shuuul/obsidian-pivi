# Notes docs guidance

Scope: files under `docs/notes/`.

## Purpose

Notes are **non-normative historical records**: audits, migration notes, experiment results, dependency investigations, and decision logs that explain why choices were made.

## What belongs here

- Historical quality or bundle analyses.
- Dependency/provider migration notes.
- Experiments and one-off investigations.
- Decision context that is useful but not part of the current system contract.

## What does not belong here

- Current architecture rules; promote them to `docs/architecture/`.
- Feature contracts or acceptance criteria; promote them to `docs/specs/`.
- Active catch-all backlog/TODO lists. Current open quality work belongs in `docs/quality-review.md`; feature-specific work belongs in that feature’s spec.

## Status and promotion rules

- Every note should have an obvious status in its heading, frontmatter-style block, or `README.md` index entry: `current`, `implemented`, `partial`, `historical`, `obsolete`, or `superseded by ...`.
- If a note becomes stable guidance, promote the durable conclusion into architecture/spec docs and mark the note as historical or superseded.
- Notes may link to architecture/spec docs for orientation, but architecture/spec docs should not need notes to define current behavior.
