---
id: "005"
title: "Hierarchical checkpoint and structured Agent report schemas"
status: Active
created: 2026-07-15
updated: 2026-07-15
coordinator: "Codex"
---

# 005 — Hierarchical checkpoint and structured Agent report schemas

## Context

`docs/11-chat-ui-evolution.md` (step 5) requires durable schemas, with compatibility tests, before any presentation work (spec 007) or Agent-run promotion (spec 008). Verified current state:

- Compaction is a single flat Pi `compaction` entry. `packages/pivi-agent-core/src/engine/pi/session/piContextCompaction.ts` owns estimation (`estimateTextTokens`, `PiContextTokenIndex`, `estimateActiveContextTokens`), policy (`shouldAutoCompact`, `selectCompactionCutPoint`), and prompts. `COMPACTION_SYSTEM_PROMPT` already produces Goal / Decisions / Artifacts / Open work / Next steps sections, but only as unstructured summary text.
- Execution: `packages/pivi-agent-core/src/engine/pi/piChatRuntimeCompaction.ts` runs an aux-agent summarization and appends via `SessionTreeStore.appendCompaction(summary, firstKeptEntryId, tokensBefore)`. `getLinearLlmContextEntries()` includes trailing compaction entries in the model context. There is no checkpoint schema version, ledger, artifact references, or source-bound metadata beyond `firstKeptEntryId`/`tokensBefore`.
- Subagent results: blocking runs return raw terminal text (`createSubagentTool.ts` → `textResult(result)`); background runs deliver text via `piBackgroundSubagentJobs.ts`, and `applyPersistedAsyncSubagentResults()` rewrites the `spawn_agent` toolResult from persisted `message_ui` results on reload. The parent model always consumes the full terminal text; there is no structured report.
- Subagent trace persistence is split between `PIVI_MESSAGE_UI` entries (`PiviMessageUiData.toolCalls[].subagent`) and the subagent's own JSONL (`packages/pivi-agent-core/src/session/subagentJsonl.ts`, `extractFinalResultFromSubagentJsonl`).

## Goal and success criteria

Outcome: versioned, tolerant schemas for hierarchical checkpoints and structured Agent reports, wired into the existing compaction and subagent-result paths, with old-file compatibility proven by fixtures. No new UI in this spec.

- [ ] A versioned `Checkpoint` schema exists in core session types covering: concise continuation summary, current goal and constraints, durable decisions, artifact references, open work/unresolved questions, concrete next steps, source entry bounds, token estimates, and `schemaVersion`. Verified by type + parser tests.
- [ ] Checkpoint data is stored so that existing Pi compaction consumers keep working: the Pi `compaction` entry keeps its current summary text; structured fields ride alongside (same entry extension or paired `message_ui`-style custom entry, per Decision). Old sessions without structured data still open, compact, and resume. Verified by fixture tests using pre-change JSONL files.
- [ ] Checkpoint creation and merge rules are implemented for the chained case (new checkpoint on top of an earlier one combines rather than discards ledger/decisions), with unit tests for chain assembly in `getLinearLlmContextEntries()`-equivalent context building.
- [ ] An `AgentReport` schema exists (objective, outcome, summary, findings, decisions, artifacts, open questions) that explicitly tolerates partial and failed runs (all fields optional except objective/outcome; outcome includes failed/cancelled/orphaned). Verified by parser tests over malformed/partial payloads.
- [ ] The subagent runtime attempts structured-report extraction from the subagent's terminal output; on validation failure it falls back to terminal text with no behavior change (docs/11 compatibility path). Both branches tested.
- [ ] `message_ui` privacy invariants hold: no external absolute paths enter JSONL through new fields (extend the existing sanitizer tests around `SessionTreeStore.appendMessageUi`).

## Scope and non-goals

In scope:

- Schema types in `packages/pivi-agent-core/src/session/types.ts` (or a sibling module) plus tolerant parse/serialize helpers.
- Writer integration in `piChatRuntimeCompaction.ts` / `sessionTreeStore.ts` (checkpoint) and `createSubagentTool.ts` / `piBackgroundSubagentJobs.ts` / `subagentJsonl.ts` (report).
- Prompt updates so the compaction aux-agent and subagents emit parseable sections; keep prompts in the existing prompt owners.
- Compatibility fixtures: pre-change JSONL, mixed old/new chains, malformed structured payloads.

Not in scope:

- Checkpoint/report presentation (spec 007 and 008).
- Changing when auto-compaction triggers or the envelope math (spec 007 covers the conservative envelope; only the data model lands here).
- Validating structured output across all provider models (docs/11: terminal text remains the compatibility path until validated; that validation campaign is follow-up evidence, not a blocker here).
- A second durable event log.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-15 | Structured checkpoint data must be additive: the plain-summary compaction entry remains readable by unmodified Pi tooling | docs/11 requires compatibility with existing Pi compaction entries and old session files | WS-01, WS-03 |
| 2026-07-15 | Reports/checkpoints are parsed tolerantly: any validation failure downgrades to today's text behavior, never throws into the turn pipeline | Schema "must tolerate partial and failed runs"; a malformed summary must not break resume | WS-02, WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `Checkpoint` schema + storage-shape decision (extend compaction entry vs paired custom entry) + tolerant parser | Codex | In progress | None | New unit suite under `tests/unit/pi/` with old-file fixtures |
| WS-02 | `AgentReport` schema + tolerant parser + partial/failed outcome coverage | Codex | Pending | None | Parser unit tests incl. malformed payloads |
| WS-03 | Checkpoint writer: compaction path emits structured fields (source bounds from `firstKeptEntryId`, token estimates from `PiContextTokenIndex`); chain merge rules in context assembly | Codex | Pending | WS-01 | Compaction integration tests; existing compaction suites stay green |
| WS-04 | Report extraction in subagent terminal path (blocking + background + reload rewrite), fallback to terminal text | Codex | Pending | WS-02 | Subagent tool/jobs suites extended; `applyPersistedAsyncSubagentResults` regression |
| WS-05 | Compatibility fixture set: pre-change sessions, mixed chains, 0.7.0-era files; idempotent re-open | Codex | Pending | WS-03, WS-04 | `npm run test -- tests/integration` session compat suites |
| WS-06 | Prompt updates for compaction aux-agent and subagent report emission | Codex | Pending | WS-01, WS-02 | Prompt snapshot tests; manual compaction run in vault |

Guidance for low-context agents:

1. Read `packages/pivi-agent-core/src/engine/pi/AGENTS.md` before editing; raw Pi SDK types stay inside `engine/pi`.
2. Schema types belong in host-neutral core `session` (not `engine/pi`) so future UI (specs 007/008) can consume them without touching the engine boundary.
3. Every new persisted field must pass the external-path sanitizer used by `appendMessageUi`; copy the existing test pattern.
4. Do not rename or repurpose existing JSONL fields; only add.

## Verification

- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build`
- Fixture-driven compatibility tests (old files unchanged behavior; new files parse in old code paths where applicable).
- Manual: trigger auto-compaction in a real vault session, resume it, fork past the checkpoint; run one blocking and one background subagent and inspect the persisted report fields.

## Documentation sync

- Numbered developer docs: `docs/11-chat-ui-evolution.md` (Hierarchical checkpoints and Structured parent report sections) plus the session/persistence numbered doc.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, `packages/pivi-agent-core/AGENTS.md`.
- Parent/package guidance: `src/ui/chat/AGENTS.md` only if runtime handoff types change.
- Root guidance and roadmap: `AGENTS.md` glossary (add Checkpoint and Agent report as canonical terms).

## Progress and handoff

### 2026-07-15 — Spec creation — coordinator

- Changed: spec drafted from repository exploration (no code changes).
- Evidence: flat compaction entry and text-only subagent results confirmed in `piChatRuntimeCompaction.ts`, `createSubagentTool.ts`, `piBackgroundSubagentJobs.ts`.
- Remaining: all workstreams.
- Blockers: none; independent of specs 002-004 and can proceed in parallel.
- Next action: claim WS-01 and WS-02 (parallelizable).

### 2026-07-16 — Activation and boundary audit — Codex

- Changed: activated spec 005 after spec 004 completed, assigned coordination and all workstreams to Codex, and started the additive schema/storage audit.
- Evidence: package and Pi-engine guidance were reread; three read-only audits are tracing checkpoint persistence/context assembly, blocking/background report delivery, and old-session/privacy fixtures.
- Remaining: choose the additive compaction-entry extension, define host-neutral tolerant schemas, then wire writers/readers without changing legacy summary/text behavior.
- Blockers: none; spec 004 is archived and supplies stable run metadata.
- Next action: reconcile the audits with current source and implement WS-01/WS-02 schemas first.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
