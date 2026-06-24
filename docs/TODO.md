# Obsius design TODO

This file tracks design follow-ups discovered during the June 2026 docs / `AGENTS.md` refresh. Treat these as maintenance candidates, not committed implementation plans; promote any medium+ item into `docs/specs/` before coding.

## Current execution status

The first implementation tranche intentionally landed only changes that were low-risk enough to complete, review, test, build, deploy, and commit in one pass. It did **not** complete every item in this file. That was a miss against the requested “finish all TODO items with subagents” execution goal.

Why the full list was not completed in that tranche:

1. Some items are independent enough for subagents to investigate or review, but not safe to merge concurrently because they touch the same stateful seams: session persistence, tab restore, runtime credential resolution, and chat controllers.
2. Several remaining items are not just additive UI polish; they change durable contracts or runtime ownership boundaries and need migration/compatibility tests before code changes are safe.
3. The tranche prioritized shippable guardrails and visible UX improvements over broad refactors, then recorded partial/not-started statuses here instead of silently over-claiming completion.

Completion rule for the remaining items: do not mark an item implemented unless the code, docs, tests, and migration/compatibility behavior are complete. Subagents can still be used, but their role should be split into independent investigation/review lanes while one owner integrates the stateful code changes.

Recommended finish order after session identity cleanup:

1. Add provider model-picker agreement and a real “Test model” action on top of the final pi-ai auth source of truth.
2. Finish MCP recovery actions after the availability summary, so auth/test/open-settings buttons reuse the already-visible server state.
3. Decompose controllers only after the above behavior changes, to avoid mixing refactors with semantic changes.

## P1 — UI / UX improvements

### 1. Improve model/provider onboarding and status visibility

> Status: partial. Provider rows now show local readiness status; model-picker agreement and a real “Test model” action remain future work.

**Why not complete yet:** The first pass added local readiness status without performing network calls. A real “Test model” action depends on the final credential ownership path and needs careful UX for rate limits, OAuth refresh, cancellation, and provider-specific error messages.

**Why:** Provider settings are powerful but still feel configuration-heavy. Users should understand what model is ready, why a model is unavailable, and how to fix it.

**Plan:**

1. Audit current provider settings UI in `src/pi/ui/models-settings/**`.
2. Add a status model that can represent:
   - ready,
   - missing API key,
   - OAuth expired,
   - provider disabled,
   - model unavailable,
   - env snippet configured but untested.
3. Surface status in provider rows and model picker entries.
4. Add a “Test model” action that performs a tiny safe request or aux query.
5. Convert low-level provider/auth errors into actionable UI text.
6. Add unit tests for status derivation helpers; manually test settings flows.

**Acceptance:**

- A user can tell why a selected model will or will not work before sending a chat turn.
- Provider status and model picker status agree.

### 2. Improve MCP availability UX

> Status: partial. Chat toolbar/dropdown now show current-turn availability counts and server active/mention labels; auth/test/open-settings recovery actions remain future work.

**Why not complete yet:** The safe first step was showing availability without eagerly connecting to servers. Recovery actions require invoking auth/test flows from chat UI and must avoid surprising users with connection attempts or OAuth prompts during ordinary composing.

**Why:** Users configure servers, but the chat UI should explain what MCP tools are active for the current turn.

**Plan:**

1. Extend MCP toolbar/dropdown data to include:
   - server connection/test status,
   - auth status,
   - tool count,
   - disabled tool count.
2. Show current-turn active MCP servers in the toolbar or status panel:
   - servers mentioned in the composer,
   - servers enabled from the toolbar.
3. Add action buttons for common failure recovery:
   - authenticate,
   - test server,
   - open settings,
   - disable for this turn.
4. Ensure `McpServerManager` remains the source of mention/active-server semantics.
5. Add tests for active-server merge behavior if helpers are changed.

**Acceptance:**

- Before send, users can see which MCP servers are active.
- On MCP auth/connection failure, UI offers the next action.

### 3. Improve session history and branch/leaf UX

> Status: partial. History rows now expose branch counts and clearer active/saved leaf labels; a visual branch map remains future work.

**Why not complete yet:** A branch map should be built after session identity naming and persistence cleanup. Otherwise it risks encoding legacy `agentState` concepts in a new UI surface.

**Why:** JSONL session tree support is powerful, but users need a clearer mental model for fork, rewind, and branch selection.

**Plan:**

1. Audit current history UI in `SessionController` / tab/session components.
2. Enhance session summaries with:
   - title,
   - last response time,
   - last model if available,
   - branch/leaf count,
   - active leaf marker.
3. Prototype a minimal branch map for sessions with multiple leaves.
4. Clarify actions:
   - open in current tab,
   - open in new tab,
   - fork from checkpoint,
   - rewind current tab.
5. Add tests around leaf list formatting if logic is extracted.

**Acceptance:**

- A user can distinguish “new session file” from “different leaf in same session”.
- Fork and rewind affordances are visibly different.

---

## P2 — Engineering quality cleanup

### 4. Review `require-await` warnings by contract

> Status: partial. Low-conflict `require-await` warnings in Pi session/runtime/tool and settings helper files were reduced; larger controller warnings remain future work.

**Why not complete yet:** Remaining warnings are mostly in large controllers or interface-bound lifecycle methods. Removing them safely overlaps with controller decomposition and should be handled when those behaviors are extracted, not by mechanically changing signatures.

**Why:** Many async functions are async only because interfaces are async. Some are legitimate; others obscure control flow.

**Plan:**

1. Group warnings by owner:
   - `PiSessionStore`,
   - `PiChatRuntime`,
   - tab cleanup,
   - skill tools,
   - settings helpers.
2. For each group, decide:
   - keep async because a port requires `Promise`,
   - remove async and update callers,
   - add an actual awaited async boundary if missing.
3. Prefer not to change public ports unless the cleanup removes real ambiguity.
4. Add comments only where async is intentionally required by an interface.
5. Run `npm run lint` and targeted tests.

**Acceptance:**

- Warnings are reduced where cleanup is safe.
- Remaining async-without-await cases are intentional and documented by type/interface context.

### 5. Continue incremental controller decomposition

> Status: not started. Keep this as follow-up work for dedicated refactor PRs.

**Why not complete yet:** This is intentionally not parallel-friendly as a single large change. `InputController`, `StreamController`, renderers, and tab lifecycle code are high-conflict files. The safe approach is one behavior extraction per PR with focused tests, after feature semantics settle.

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

### 6. Refresh docs governance after implemented notes

> Status: partial. This TODO now records implemented/partial statuses; a recurring release-prep checklist remains future work.

**Why not complete yet:** The immediate stale-status problem is fixed in this file. A recurring checklist should be added when the remaining implementation work has stabilized, otherwise it will describe an interim process rather than the final docs workflow.

**Why:** Notes can become misleading when implemented but left as future plans.

**Plan:**

1. Add a lightweight quarterly or release-prep docs audit checklist.
2. For every note/spec changed by implementation, require one of:
   - update status to implemented/partial/obsolete,
   - promote stable decisions to architecture docs,
   - delete or archive superseded detail.
3. Keep `docs/glossary.md` as canonical terminology and avoid duplicating terminology tables in root `AGENTS.md`.

**Acceptance:**

- Future docs audits find fewer stale “future” notes.
- New contributors and agents can identify authoritative docs quickly.
