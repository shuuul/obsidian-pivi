---
id: "NNN"
title: "Spec title"
status: Draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
coordinator: "Agent or person responsible for coordination"
---

# NNN — Spec title

## Context

Describe the verified current state, why this work is long-running, and the repository evidence that motivates it.

## Goal and success criteria

State the outcome, then list observable criteria that must all hold before completion.

- [ ] Criterion with a concrete verification method.

## Scope and non-goals

In scope:

- Required behavior or subsystem.

Not in scope:

- Explicitly excluded work.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| YYYY-MM-DD | Decision-complete choice | Repository evidence and tradeoff | WS-01 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Bounded deliverable | Unassigned | Pending | None | Command or observable check |

## Verification

List exact commands, fixtures, manual scenarios, and acceptance evidence. Keep performance and correctness claims tied to reproducible conditions. Include `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/NN-*.md` or `None` with rationale.
- Nearest local guidance: `<changed-area>/AGENTS.md` or `None` with rationale.
- Parent/package guidance: `<parent>/AGENTS.md` or `None` with rationale.
- Root guidance and roadmap: `AGENTS.md`, `docs/10-roadmap-release-and-maintenance.md`, or `None` with rationale.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### YYYY-MM-DD — Agent/task name — WS-01

- Changed:
- Evidence:
- Remaining:
- Blockers:
- Next action:

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated. The coordinator then sets `status: Completed`, updates the date, moves the unchanged filename to `archive/`, and moves its index entry in the same change.
