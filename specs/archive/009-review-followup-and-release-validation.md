---
id: "009"
title: "Review follow-up and release validation"
status: Completed
created: 2026-07-16
updated: 2026-07-16
coordinator: "/root"
---

# 009 — Review follow-up and release validation

## Context

The 0.9.0-to-HEAD review found no boundary, architecture, spec, i18n, or production-performance-harness violations, but identified a bounded set of dead code, duplicated presentation rules, an oversized projection-store responsibility, a missing Active Work Shelf React test, stale documentation facts, and release-candidate evidence gaps. This work is tracked as one coordinated follow-up because the changes cross core session schemas, the React presentation package, chat projection storage, documentation, and live Obsidian verification.

## Goal and success criteria

Complete every actionable review finding without weakening the established architecture or rewriting archived historical evidence.

- [x] Confirmed dead code, unused exports, and unused CSS are removed, and the Agent report fence language has one source of truth.
- [x] Activity status labels/icons and elapsed-time formatting have one presentation implementation consumed by Activity rows and Agent groups.
- [x] AgentRun entity derivation is separated from `ChatProjectionStore` while preserving projection ordering, ownership, identity, and subscription behavior.
- [x] Active Work Shelf has dedicated React tests for visibility, aggregation, lifecycle state, and owner navigation.
- [x] `docs/11-chat-ui-evolution.md` and root `AGENTS.md` report internally consistent completion, test, and bundle facts.
- [x] Remaining provenance and manual RC risks are either closed with reproducible evidence or retained as explicit, accurately scoped limitations.
- [x] Typecheck, lint, focused/full tests, architecture/spec/boundary checks, production build, deployment, and live Obsidian reload checks pass.

## Scope and non-goals

In scope:

- Every dead-code, documentation, structural-smell, test-gap, and release-risk item listed by the completed review.
- Focused refactors that reduce duplicated presentation logic and separate pure AgentRun derivation.
- Automated and live Obsidian verification that is possible in the configured local environment.

Not in scope:

- Reopening or rewriting the decisions of archived specs 001–008.
- Inventing unavailable 0.7.0 pre-upgrade bytes or representing synthetic fixtures as captured user data.
- Adding new product features or compatibility layers.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-16 | Keep archived specs immutable as historical execution records; add current RC evidence to durable release/UI documentation and this spec. | The review confirmed the archived specs are decision-complete and already record deviations honestly. | WS-05 |
| 2026-07-16 | Extract only pure AgentRun derivation from the projection store; retain sequencing, ownership checks, identity reconciliation, publication, and subscriptions in the store. | This creates a responsibility boundary without introducing thin wrappers or changing the event plane. | WS-03 |
| 2026-07-16 | Centralize status/icon/elapsed presentation in the React package and keep imperative rendering limited to translated adapter inputs. | React owns Activity and Agent Group chrome; one presentation model prevents lifecycle drift. | WS-02 |
| 2026-07-16 | Treat unavailable historical bytes as a provenance limitation, never as a test failure that can be repaired with synthetic data. | Repository tests explicitly distinguish synthetic legacy fixtures from captured 0.7.0 data. | WS-05 |
| 2026-07-16 | Use the immutable `0.7.0` tag writer over deterministic synthetic inputs as authentic writer-output evidence, while explicitly withholding any captured-user-vault claim. | This closes the code-provenance gap reproducibly even though no pre-upgrade user vault is available. | WS-05 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Remove dead code/CSS/exports and unify Agent report fence language with regression coverage | /root/ws01_cleanup | Done | None | Focused core/UI tests, lint, typecheck |
| WS-02 | Centralize Activity status/icon and elapsed presentation | /root/ws02_activity | Done | None | React and imperative presentation tests |
| WS-03 | Extract pure AgentRun derivation from `chatProjectionStore.ts` | /root/ws03_projection | Done | None | Projection identity/order/AgentRun tests |
| WS-04 | Add dedicated Active Work Shelf React coverage | /root/ws04_shelf_tests | Done | WS-02 interface stability | Focused jsdom tests |
| WS-05 | Correct docs and close or accurately record release-candidate evidence gaps | /root | Done | WS-01–WS-04 for final facts | Spec/doc gates, bundle analysis, Obsidian CLI evidence |
| WS-06 | Run repository-wide gates, deploy, reload, and archive the spec | /root | Done | WS-01–WS-05 | Full command matrix and live runtime checks |

## Verification

- Focused Jest tests for continuation schemas, subagent tool output, activity presentation, projection store/AgentRun behavior, and Active Work Shelf.
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run check:boundaries`
- `npm run check:architecture`
- `npm run check:specs`
- i18n dead-key gate via the repository script that owns it.
- `npm run build` and `npm run analyze:bundle`; verify production performance-recorder imports/hits remain absent.
- Deploy through the configured build and run Obsidian CLI reload/error checks plus the feasible lifecycle, multi-view, Hover Editor, MCP OAuth, and near-limit inspector scenarios.

## Documentation sync

- Numbered developer docs: `docs/10-roadmap-release-and-maintenance.md`, `docs/11-chat-ui-evolution.md`.
- Nearest local guidance: `src/ui/chat/AGENTS.md`, `packages/pivi-react/AGENTS.md`, and `tests/AGENTS.md` only where module ownership or verification guidance changes.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` if the continuation-schema public surface changes.
- Root guidance and roadmap: `AGENTS.md` and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-16 — /root — WS-05

- Changed: Created the coordinated follow-up spec and recorded responsibility-boundary and evidence-handling decisions.
- Evidence: Review findings, clean starting worktree, and archived specs 001–008 indexed in `specs/README.md`.
- Remaining: All implementation, focused verification, documentation correction, and live RC checks.
- Blockers: None.
- Next action: Claim and execute WS-01–WS-04, then reconcile durable docs and final evidence.

### 2026-07-16 — /root/ws03_projection — WS-03

- Changed: Extracted pure AgentRun derivation into `packages/pivi-react/src/store/agentRunProjection.ts`; the projection store retains event ordering, ownership/anomaly gates, identity reconciliation, publication, and subscriptions. The public store subpath exports the domain function directly from its owner.
- Evidence: 32 focused Jest tests passed; typecheck, lint, and `git diff --check` passed.
- Remaining: Documentation sync and repository-wide verification.
- Blockers: None.
- Next action: Record the new package boundary in owning guidance and run the full projection suite.

### 2026-07-16 — /root/ws04_shelf_tests — WS-04

- Changed: Added a dedicated React test suite for the default-off Active Work Shelf.
- Evidence: Tests cover disabled/empty hiding, cross-tab top-level background aggregation, sync/nested filtering, queued/running/waiting status, owner navigation identity, and terminal removal; 20 focused Shelf/ChatShell tests passed.
- Remaining: Full-suite verification.
- Blockers: None.
- Next action: Include the suite in final coverage and update the React test index.

### 2026-07-16 — /root/ws01_cleanup — WS-01

- Changed: Removed the dead owner-window InputEvent helper, the internal-only ChatState re-export, unused settings CSS, and unnecessary imperative helper exports; removed the production-only test formatter and moved fixture formatting into tests; the subagent prompt now consumes the canonical Agent report fence-language constant. Updated the shared UI guidance after deleting its private-API helper.
- Evidence: 85 focused tests passed across protocol, styles, ChatState, and imperative presentation; typecheck, lint, architecture, CSS build, and `git diff --check` passed.
- Remaining: Repository-wide verification.
- Blockers: None.
- Next action: Include all affected suites in final coverage and confirm the i18n dead-key gate remains green.

### 2026-07-16 — /root/ws02_activity — WS-02

- Changed: Added one React-owned presentation model for all seven Activity statuses, icon semantics, orphaned accessibility copy, and elapsed formatting; both React and imperative adapters now consume it while retaining their own DOM/icon mounting and owner-realm timer behavior.
- Evidence: 67 focused tests passed; typecheck, lint, architecture, boundaries, and `git diff --check` passed.
- Remaining: Documentation sync and repository-wide verification.
- Blockers: None.
- Next action: Record the shared presentation responsibility in package/chat guidance and run final coverage.

### 2026-07-16 — /root/ws05_provenance — WS-05

- Changed: Added a deterministic fixture generator that uses the immutable `0.7.0` tag writer and a HEAD compatibility test for the resulting version-3 session. Kept the generated fixture explicitly separate from captured user-vault provenance.
- Evidence: Tag commit `f27ca3be149ecf4497f8d2e6ab8a236d14308c59`; Pi dependencies verified at `0.80.6`; fixture reproduced twice at 1,957 bytes with SHA-256 `3c191e3440fc1a95859ddb6a07687a74a2b5cc383062c0fab3b0c53e357ef67b`. The integration test verifies external-path migration into the device overlay, message/title/MCP restoration, sidecar marking, and byte-idempotent second open.
- Remaining: None.
- Blockers: None.
- Next action: Include the generator and compatibility suite in final repository verification.

### 2026-07-16 — /root — WS-05 release-candidate evidence

- Changed: Corrected steps 7 and 8 in `docs/11`, refreshed the root quality snapshot, and added a release evidence matrix to `docs/10`.
- Live evidence: Three Pivi views across two owner realms survived plugin reload, vault reload, and full app quit/relaunch with zero captured errors; temporary leaves were removed. Inline edit mounted one modal/root and Escape removed both. The isolated development 20-Agent workload exported a clean trace and restored its disposable session. A focused 98% Context Inspector test verified warning, budget breakdown, estimates, and dismissal.
- Explicit limitations: Hover Editor is not installed in the configured vault, and no MCP OAuth server is configured. Those named third-party live rows remain environment-limited; the relevant owner-realm, lifecycle, and OAuth contract tests pass.
- Remaining: Final production rebuild, deployment, reload, and repository-wide gates.
- Blockers: None.
- Next action: Restore the production bundle and run the final matrix.

### 2026-07-16 — /root — WS-06 final verification

- Full verification passed: 243 Jest suites / 1,859 tests; 68.96% statements, 58.35% branches, 66.04% functions, and 70.42% lines. Typecheck, zero-warning lint, boundaries (including architecture, package guidance, specs, and i18n dead keys), generator syntax, deterministic fixture reproduction, and `git diff --check` passed.
- Production evidence: `npm run build`, `npm run check:bundle-size`, and `npm run analyze:bundle` passed. `main.js` is 3,071,059 bytes with 2,171,821 bytes of headroom; local and deployed SHA-256 values match. The concrete development recorder contributes zero metafile inputs and development command/trace markers have zero production bundle hits; only the 323-byte disabled controller contract remains.
- Live evidence: Final production plugin reload mounted the remaining Pivi view and captured no Obsidian errors.
- Documentation audit: Durable ownership, test topology, fixture provenance, completion markers, release evidence, current metrics, and scoped limitations are synchronized into the numbered handbook and layered guidance.
- Remaining: None.
- Blockers: None.
- Next action: Archive this completed spec and update the index.

## Completion summary

All actionable review findings are closed. Dead utilities, exports, CSS, and test-only production helpers were removed; Agent report fence language is canonical. Activity presentation and elapsed formatting now have one React-owned model shared by React and imperative adapters. Pure AgentRun derivation has its own module while the projection store retains sequencing, validation, identity reconciliation, publication, and subscriptions. The Active Work Shelf has a dedicated React suite.

The documentation defects and stale quality metrics are corrected. Authentic `0.7.0` writer output over deterministic synthetic inputs provides reproducible migration provenance without being mislabeled as captured user data. Live lifecycle, multi-view, inline-edit, stored-run, production isolation, deployment, and reload evidence is recorded. Hover Editor and live MCP OAuth remain explicitly environment-limited because the required third-party plugin/server is absent; no unperformed manual check is represented as passed.

Final verification on 2026-07-16 passed with 243 suites / 1,859 tests, all repository gates, a 3,071,059-byte production artifact, matching deployed checksum, zero production recorder contribution, and a clean final Obsidian reload.
