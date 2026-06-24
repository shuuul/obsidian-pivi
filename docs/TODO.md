# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## Current execution status

The first implementation tranche intentionally landed only changes that were low-risk enough to complete, review, test, build, deploy, and commit in one pass. It did **not** complete every item in this file. That was a miss against the requested “finish all TODO items with subagents” execution goal.

Why the full list was not completed in that tranche:

1. Some items are independent enough for subagents to investigate or review, but not safe to merge concurrently because they touch the same stateful seams: session persistence, tab restore, runtime credential resolution, and chat controllers.
2. Several remaining items are not just additive UI polish; they change durable contracts or runtime ownership boundaries and need migration/compatibility tests before code changes are safe.
3. The tranche prioritized shippable guardrails and visible UX improvements over broad refactors, then recorded partial/not-started statuses here instead of silently over-claiming completion.

Completion rule for the remaining items: do not mark an item implemented unless the code, docs, tests, and migration/compatibility behavior are complete. Subagents can still be used, but their role should be split into independent investigation/review lanes while one owner integrates the stateful code changes.

Recommended finish order: handle engineering cleanups one at a time, because the remaining work touches large controllers rather than isolated UX affordances.

## P2 — Engineering quality cleanup

### 1. Continue incremental controller decomposition

> Status: in progress. Recent behavior-preserving extractions moved session history branch rendering and queued-message indicator rendering into focused helpers with targeted tests. Keep this item open until the remaining controller size/complexity warnings are reduced or split into smaller tracked follow-ups.

**Why not complete yet:** This is intentionally not parallel-friendly as a single large change. `InputController`, `StreamController`, renderers, and tab lifecycle code are high-conflict files. The safe approach is one behavior extraction per PR with focused tests, after feature semantics settle.

**Completed increments:**

- Extracted chat history branch-list rendering from `SessionController` into a dedicated renderer helper.
- Extracted queued-message indicator DOM rendering from `InputController` into a dedicated helper with focused unit coverage.
- Extracted pending regular-tool buffering/rendering/output handling from `StreamController` into a dedicated helper with focused unit coverage.
- Extracted regular tool-result status/render/finalization handling from `StreamController` into a dedicated helper with focused unit coverage.
- Extracted streaming-time queued-turn submission from `InputController` into a dedicated helper with focused unit coverage.

**Why:** `InputController`, `StreamController`, and some renderers exceed size/complexity thresholds. Large rewrites are risky; behavior-based extraction is safer.

**Plan:**

1. Pick one hotspot per PR.
2. Extract by behavior, not by arbitrary line count:
   - queued turn submission,
   - provider boundary validation,
   - stream tool-result routing,
   - subagent lifecycle handling,
   - render queue scheduling.
3. Add focused unit tests around extracted helpers.
4. Keep controller public interfaces stable.
5. Avoid mixing UI changes with refactor commits.

**Acceptance:**

- Complexity/line warnings decline gradually.
- Behavior stays covered by focused tests.
