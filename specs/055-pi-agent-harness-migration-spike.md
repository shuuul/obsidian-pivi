---
id: "055"
title: "Pi AgentHarness migration spike"
status: Active
created: 2026-09-29
updated: 2026-09-29
coordinator: "Claude Code (refactor/pi-compat-and-architecture)"
---

# 055 — Pi AgentHarness migration spike

## Context

Pivi's durable session layer is built on the legacy `@earendil-works/pi-coding-agent` session stack while the upstream Pi core is moving to a different, host-neutral one.

Verified against the exact `0.87.1` pin:

- `@pivi/engine-pi` constructs `SessionManager` from `pi-coding-agent` (`CURRENT_SESSION_VERSION = 3`) in `session/sessionTreeStore.ts` and `session/sessionJsonlIndex.ts`, and imports `buildContextEntries`, `buildSessionContext`, `convertToLlm`, `estimateTokens`, `findCutPoint`, and `sessionEntryToContextMessages` from its root. The production build narrows that root to a generated facade because it statically re-exports the CLI/TUI (`pi-coding-agent-public-facade` in `packages/engine-pi/compatibility-manifest.json`).
- Rewind/eager flush reach three private members (`_rewriteFile`, `flushed`, `fileEntries`) through `session/piSessionManagerPrivateAdapter.ts` (`session-manager-private-surface`).
- Pivi's own session layer (`packages/engine-pi/src/session/`) is about 5.7k lines: JSONL index, range reader, cloud recovery, tree store, message mapping, and compaction.
- `pi-agent-core@0.87.1` now ships `AgentHarness` from its root export: v4 JSONL session storage (`JsonlStorage`) "backed by an injected filesystem capability" with legacy v3 upgrade, compaction and branch summarization, lane-based operations, steering/follow-up queue modes, skills, and prompt templates. Its `FileSystem` interface (`dist/harness/types.d.ts`) is Result-typed and host-injected, which maps onto a vault adapter rather than Node `fs`.
- The core replacements are not drop-in: the same function names take the new `Entry` type instead of `SessionEntry`, and `buildSessionContext` becomes async over a `Context`.
- The harness is not complete: `watchSession` throws `SliceNotImplemented`, and the public suspended-run drive is documented as pending a later upstream milestone.
- Pivi never uses the core `Agent` steering path (`steer`, `followUp`, `getSteeringMessages`, `getFollowUpMessages`). The composer queue (`src/ui/chat/composer/ComposerQueue.ts`, `ComposerStreamingQueue.ts`) is FIFO and submits each queued message as a new turn after the current turn ends.

Why long-running: the outcome decides whether the next major engine change is a session-format migration, and any migration touches persistence, recovery, compaction, and rewind across several commits.

## Goal and success criteria

Decide, with evidence, whether and when Pivi should move its session/runtime foundation from the `pi-coding-agent` v3 `SessionManager` to the `pi-agent-core` `AgentHarness`, and leave the repository tracking that decision.

- [ ] A throwaway prototype (not merged into production paths) opens, appends to, and reopens a Pivi session through `JsonlStorage` over a vault-backed `FileSystem` adapter, verified by a focused Jest test against the in-memory vault mock.
- [ ] Legacy v3 → v4 upgrade behaviour is characterized against the frozen fixtures used by `npm run test:pi-compat` (`tests/integration/piSessionFixtureCompatibility.test.ts` and `piSessionTagGeneratedCompatibility.test.ts`): which Pivi custom entries (`pivi/session-meta`, checkpoints, compaction details, message-UI overlays) survive, and whether older Pivi versions can still read an upgraded file.
- [ ] Production bundle delta of importing the harness surface is measured with `npm run analyze:bundle` and recorded here.
- [ ] Each Pivi session responsibility (append, index/range reads, cloud recovery journal, fork, rewind/truncate, compaction, subagent persistence) is mapped to a harness capability, a remaining Pivi adapter, or a blocking upstream gap.
- [ ] Native steering is evaluated as a product option against the current FIFO composer queue, with a recommendation.
- [ ] A go / wait / no-go decision is recorded in Decisions, and `compatibility-manifest.json` gains or updates entries whose `removalCondition` names the harness milestone that unblocks removal.

## Scope and non-goals

In scope:

- Reading upstream harness types and behaviour at the exact pin, prototyping behind test-only code, bundle measurement, fixture compatibility characterization.
- Recording blockers upstream-facing (issue `#113` or a new tracking issue).

Not in scope:

- Changing the persisted session format, production runtime wiring, or user-visible behaviour.
- Bumping the Pi pin (follow the normal `npm run test:pi-compat` route separately).
- Implementing native steering in the composer; this spec only recommends.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-29 | Do not migrate at `0.87.1`; run a spike first. | `watchSession` is unimplemented and suspended-run drive is not public, and the v4 format is not readable by current `SessionManager`, so a production migration now would be one-way for users' session files. | WS-01–WS-05 |
| 2026-09-29 | Prototype code stays under `tests/` or a clearly unexported engine module until a go decision. | Keeps the production composition boundary (`application/*`) and bundle unchanged during evaluation. | WS-01 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Vault `FileSystem` adapter prototype plus `JsonlStorage` open/append/reopen test. | Unassigned | Pending | None | Focused Jest test passes; no production import added (`npm run check:architecture`). |
| WS-02 | v3→v4 upgrade characterization over frozen fixtures, including Pivi custom entries and downgrade readability. | Unassigned | Pending | WS-01 | Findings table in this spec with fixture names and entry types. |
| WS-03 | Bundle delta measurement for harness imports. | Unassigned | Pending | WS-01 | `npm run analyze:bundle` base/head numbers recorded here. |
| WS-04 | Responsibility map: Pivi session layer vs harness capabilities and upstream gaps. | Unassigned | Pending | WS-01 | Table in this spec reviewed against `packages/engine-pi/AGENTS.md`. |
| WS-05 | Native steering vs FIFO queue recommendation. | Unassigned | Pending | None | Recommendation recorded with the composer/runtime files it would touch. |
| WS-06 | Decision, manifest updates, and documentation sync. | Unassigned | Pending | WS-01–WS-05 | `npm run check:pi-compatibility` and `npm run check:specs` pass. |

## Verification

- `npm run test -- <prototype test path>` for WS-01.
- `npm run test:pi-compat` stays green (the spike must not change existing compatibility behaviour).
- `npm run analyze:bundle` for WS-03.
- `npm run check:architecture`, `npm run check:pi-compatibility`, and `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md` (engine technology choice) and `docs/10-roadmap-release-and-maintenance.md` (roadmap entry) once a decision is recorded.
- Nearest local guidance: `packages/engine-pi/AGENTS.md` (session layer and `AgentSession` rationale paragraphs).
- Parent/package guidance: `packages/engine-pi/README.md` if the public surface changes; otherwise `None`.
- Root guidance and roadmap: root `AGENTS.md` "Pi Engine Package" bullet if the decision changes the stated upstream-entrypoint policy.

## Progress and handoff

### 2026-09-29 — Claude Code — spec creation

- Changed: Created this spec from the architecture review on branch `refactor/pi-compat-and-architecture`.
- Evidence: Context section facts were read from `node_modules/@earendil-works/pi-agent-core@0.87.1` (`dist/index.d.ts`, `dist/harness/**`, `README.md`) and `pi-coding-agent@0.87.1` (`dist/core/session-manager.js`).
- Remaining: WS-01–WS-06.
- Blockers: None for the spike; production migration is blocked on upstream harness completeness.
- Next action: WS-01 prototype.

## Completion summary

Pending.
