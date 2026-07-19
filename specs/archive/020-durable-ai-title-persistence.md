---
id: "020"
title: "Durable AI title persistence"
status: Completed
created: 2026-07-19
updated: 2026-07-19
coordinator: "/root"
---

# 020 — Durable AI title persistence

## Context

Pivi generated session titles through a callback-based auxiliary query. Callback failures could be swallowed, and the generated title could become visible without an explicit persistence-first contract.

## Goal and success criteria

Keep title generation in the background while making JSONL the source of truth for every successful model title.

- [x] `TitleGenerationService.generateTitle()` directly returns a structured result.
- [x] A successful model title is appended as `pivi/session-meta` with `titleSource: "model"` before memory or UI publication.
- [x] A late model result cannot overwrite a user-customized title.
- [x] Query failure retains the first-prompt fallback.
- [x] JSONL persistence failure keeps the fallback title, logs the error, and displays a localized Notice.

## Scope and non-goals

In scope:

- Returned title-generation results instead of callbacks.
- Persistence-before-publication ordering.
- Visible persistence failure and localized text.
- Regression coverage and durable documentation.

Not in scope:

- Session directory or identity changes.
- Device-partitioned history.
- Tab-state persistence changes.
- Changes to `SessionRef` or JSONL schemas.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-19 | Keep title generation asynchronous relative to the main turn. | Title generation must not delay the assistant response. | WS-01 |
| 2026-07-19 | Publish in JSONL → memory → UI order. | Prevents a model title that exists only in memory. | WS-01 |
| 2026-07-19 | Treat query failure as fallback behavior and persistence failure as a visible error. | Separates provider degradation from loss of durable state. | WS-01 |
| 2026-07-19 | Withdraw the proposed device-session partitioning work. | The user requested that only durable AI-title behavior remain. | WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Returned title result and ordered durable publication | `/root/title_persistence` | Done | None | Query-service and coordinator tests |
| WS-02 | Remove device-session partitioning implementation and documentation | `/root` | Done | None | Diff audit and full repository validation |

## Verification

- Focused query-backed title, coordinator, open-session manager, and Pi session-store tests — 5 suites and 59 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run check:boundaries` — passed, including architecture, package README, i18n, and spec checks.
- `npm run test` — 263 suites and 2,035 tests passed.
- `npm run build` — passed and deployed the production artifacts.
- `obsidian plugin:reload id=pivi` — passed.
- `obsidian dev:errors` — `No errors captured.`

## Documentation sync

- `docs/02-architecture-and-technology.md`
- `docs/05-tabs-sessions-and-history.md`
- Root `AGENTS.md`
- All locale catalogs for the persistence-failure Notice.

## Progress and handoff

### 2026-07-19 — /root — WS-01–02

- Changed: Retained persistence-first model titles and removed the previously implemented device identity, partition, recovery, migration, and local Tab-state changes.
- Evidence: Title behavior has focused regression coverage; the full verification matrix above passed after the device-session changes were removed.
- Remaining: None.
- Blockers: None.
- Next action: None.

## Completion summary

Model-generated titles now become visible only after their `pivi/session-meta` entry is durable. Query failures retain the first-prompt fallback, user renames win over late results, and persistence failures are logged and shown without creating a memory-only title. Session paths, Tab-state persistence, and cross-device behavior remain otherwise unchanged.
