---
id: "015"
title: "Repository Markdown refresh"
status: Completed
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex"
---

# 015 — Repository Markdown refresh

## Context

The repository has layered root, package, feature, test, script, handbook, release, and historical Markdown. Recent Obsidian review hardening changed settings compatibility, MCP startup behavior, CLI defaults, DOM ownership, Vault enumeration, and validation evidence. A repository-wide audit is required so current guidance matches the implementation without rewriting generated release notes or historical execution records.

## Goal and success criteria

Audit every tracked Markdown file and leave current documentation concise, internally consistent, and aligned with the repository.

- [x] Every tracked Markdown file is assigned to an audit workstream.
- [x] Current README, handbook, package, feature, test, and script guidance uses valid paths, commands, versions, and ownership terms.
- [x] Point-in-time metrics and completed execution history do not leak into durable operational guidance.
- [x] Generated `CHANGELOG.md` and archived specs retain historical meaning; only broken structure or links are corrected.
- [x] Markdown whitespace, links, spec lifecycle checks, and repository boundary checks pass.

## Scope and non-goals

In scope:

- All tracked `*.md` files outside ignored dependency, build, coverage, and generated artifact directories.
- Synchronization with the current implementation and the existing npm/TypeScript/Obsidian/release conventions.
- Removal of stale duplication, invalid commands, obsolete paths, contradictory terminology, and speculative placeholders.

Not in scope:

- Reformatting accurate prose merely for stylistic preference.
- Modifying source code, configuration, generated release content, or historical decisions to make documentation checks pass.
- Adding new repository tooling or dependencies.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Apply `init-repo` as an audit framework, not as a scaffolding template | The repository already has established npm workspaces, hooks, CI, release automation, and layered guidance | All |
| 2026-07-17 | Audit generated and historical Markdown without normalizing it to current behavior | `CHANGELOG.md` and archived specs are evidence of their own release/work period | WS-01, WS-06 |
| 2026-07-17 | Preserve all pre-existing working-tree edits and divide write ownership by file group | The Obsidian review implementation is complete but intentionally uncommitted | All |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Root README, handbook index, getting-started, architecture, lifecycle, PR template, and generated changelog audit | md_root_arch | Done | None | Link/path/command scan and diff review |
| WS-02 | Input, session, subagent, and rendering handbook audit | md_flows | Done | None | Link/path/terminology scan and diff review |
| WS-03 | Tools, settings, development, release, and UI-evolution handbook audit | md_integrations | Done | None | Current implementation/config comparison |
| WS-04 | Package-level README and AGENTS guidance audit | md_packages | Done | None | Package export/path comparison |
| WS-05 | App and UI layered AGENTS guidance audit | md_src_guides | Done | None | Source ownership/path comparison |
| WS-06 | Tests, scripts, fixtures, spec template/index, and archived spec audit | md_tests_specs | Done | None | `npm run check:specs` plus command/path scan |
| WS-07 | Cross-repository reconciliation and final verification | Codex | Done | WS-01–WS-06 | Markdown/link checks and repository quality commands |

## Verification

- `git diff --check -- '*.md'`
- Validate every relative Markdown link target and local code/path reference that can be checked mechanically.
- `npm run check:specs`
- `npm run check:boundaries`
- Run focused commands cited by changed operational examples when practical.

## Documentation sync

- Numbered developer docs: all `docs/*.md` files are in scope.
- Nearest local guidance: all tracked nested `AGENTS.md` files are in scope.
- Parent/package guidance: all package README and AGENTS files are in scope.
- Root guidance and roadmap: `README.md`, `AGENTS.md`, `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-07-17 — Codex — WS-07

- Changed: Created the tracked audit contract and reserved workstreams before delegation.
- Evidence: Markdown inventory collected with `rg --files -g '*.md'` and dirty worktree reviewed.
- Remaining: Delegate file groups, reconcile findings, verify, and archive this spec.
- Blockers: None.
- Next action: Assign WS-01 through WS-06 to non-overlapping subagents.

### 2026-07-17 — md_root_arch — WS-01

- Changed: Corrected development-watch behavior, CLI-only capability descriptions, dual-store chat flow, settings-version fallback, remote-only MCP warmup, and the PR verification checklist.
- Evidence: All relative links and referenced npm scripts in the assigned current docs resolve; `git diff --check` and `npm run check:boundaries` passed.
- Remaining: None in WS-01. `docs/02-architecture-and-technology.md` and generated `CHANGELOG.md` were audited without edits.
- Blockers: None.
- Next action: Coordinator should reconcile terminology with the remaining handbook and local guidance workstreams.

### 2026-07-17 — md_tests_specs — WS-06

- Changed: Corrected Jest project/test examples, owner-realm test setup guidance, fixture provenance requirements, bundle-size/spec-checker documentation, and spec closeout instructions.
- Evidence: `npm run check:specs`; 19 focused tests; exact `-t` example; relative-link, script/path, and `git diff --check` validation all passed.
- Remaining: Two non-Markdown scripts still mention the removed root quality snapshot; they are outside this Markdown-only task.
- Blockers: None.
- Next action: Coordinator should retain archived specs unchanged and decide whether to record the script wording as a separate follow-up.

### 2026-07-17 — md_packages — WS-04

- Changed: Aligned package exports, Base/graph enumeration boundaries, host-neutral Skills prompting, MCP startup timing, settings-search aliases, owner-realm inline-edit containers, clipboard-free MCP import, and fixed two Pi-engine guide parent links.
- Evidence: Eleven package Markdown files passed relative-link, export-target, source-path, and `git diff --check` validation.
- Remaining: None in WS-04; accurate package guidance was left unchanged where no correction was needed.
- Blockers: None.
- Next action: Coordinator should reconcile package terminology with root and feature guidance.

### 2026-07-17 — md_integrations — WS-03

- Changed: Aligned security boundaries, owner-realm/settings compatibility, current test entrypoints, durable release quality gates, implemented UI baselines, and plugin-level reload guidance across docs 07–11.
- Evidence: Five-file relative links, eleven npm scripts, `git diff --check`, `npm run lint`, and `npm run check:boundaries` passed.
- Remaining: Coordinator should confirm the concurrently edited docs/03 MCP wording matches remote-only prefetch and lazy stdio.
- Blockers: None.
- Next action: Reconcile handbook terminology and retain dated performance/release evidence only where its historical scope is explicit.

### 2026-07-17 — md_flows — WS-02

- Changed: Corrected image entrypoints, ambient versus explicit selection behavior, legacy leaf compatibility, fork flush/cleanup claims, unload ordering, and blocking/background subagent flow/status terminology.
- Evidence: Relative links, cited implementation paths, and `git diff --check` passed for docs 04–06.
- Remaining: Record implementation follow-ups for direct-send ambient selection, fork `null` cleanup, and unload persistence ordering.
- Blockers: None.
- Next action: Coordinator should add the verified implementation gaps to durable current-risk guidance without changing source in this Markdown-only task.

### 2026-07-17 — md_src_guides — WS-05

- Changed: Corrected three-store ownership, semantic adapter responsibilities, owner-realm DOM rules, MCP startup timing, rendering entity terminology, file-context layering, and inline-edit responsibilities across nine source guidance files.
- Evidence: All inheritance links, `git diff --check`, and `npm run check:boundaries` passed.
- Remaining: Record the verified `FileChipsView` missing-root owner-realm gap as a code follow-up.
- Blockers: None.
- Next action: Coordinator should reconcile the local owner-realm rule with current-risk guidance without editing source in this task.

### 2026-07-17 — Codex — WS-07 closeout

- Changed: Reconciled all workstreams, added verified implementation gaps to the roadmap, and preserved generated release notes and archived specs as historical evidence.
- Evidence: Fifty-six workspace Markdown files audited; zero broken relative links; zero unknown npm scripts; `git diff --check -- '*.md'`, `npm run lint`, and `npm run check:boundaries` passed.
- Remaining: Source and script follow-ups are listed under `docs/10-roadmap-release-and-maintenance.md` Next and are outside this Markdown-only task.
- Blockers: None.
- Next action: Archive this completed spec and return the updated documentation for review.

## Completion summary

Completed a repository-wide Markdown audit using six non-overlapping subagent workstreams plus coordinator reconciliation. Current product, handbook, package, feature, test, script, PR, and spec guidance now matches the implemented npm/Obsidian/runtime boundaries; volatile quality snapshots were replaced with durable gates; broken links and stale commands were corrected. Generated `CHANGELOG.md` and specs 001–014 were audited without rewriting their historical evidence. Validation passed for Markdown whitespace, all relative links, npm script references, lint, spec lifecycle, package README coverage, i18n dead keys, and architecture boundaries. Four code/script follow-up areas discovered by the audit are recorded in the roadmap rather than changed outside scope.
