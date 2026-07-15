---
id: "005"
title: "Hierarchical checkpoint and structured Agent report schemas"
status: Active
created: 2026-07-15
updated: 2026-07-16
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
| 2026-07-16 | Store checkpoints in Pi's existing `compaction.details.piviCheckpoint` extension slot | Pi 0.80.6 exposes typed compaction details; the plain summary, leaf identity, append-only bytes, fork behavior, and unmodified Pi context semantics remain unchanged | WS-01, WS-03, WS-05 |
| 2026-07-16 | Structured artifact references accept only vault-relative paths | Synced checkpoint/report fields must not introduce POSIX, Windows-drive, UNC, or `file://` device paths | WS-01, WS-02, WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | `Checkpoint` schema + storage-shape decision (extend compaction entry vs paired custom entry) + tolerant parser | Codex | Done | None | `continuationSchemas.test.ts`: valid/normalized, malformed/version/path rejection, chained merge |
| WS-02 | `AgentReport` schema + tolerant parser + partial/failed outcome coverage | Codex | Done | None | `continuationSchemas.test.ts`: 4 outcomes, partial/malformed payloads, fenced extraction/fallback |
| WS-03 | Checkpoint writer: compaction path emits structured fields (source bounds from `firstKeptEntryId`, token estimates from `PiContextTokenIndex`); chain merge rules in context assembly | Codex | Done | WS-01 | 5 focused suites / 82 tests; real Pi append/reopen/details/context compatibility passes |
| WS-04 | Report extraction in subagent terminal path (blocking + background + reload rewrite), fallback to terminal text | Codex | Done | WS-02 | 6 focused suites / 103 tests: blocking/background, raw UI trace, reload, JSONL reader, privacy fallback |
| WS-05 | Compatibility fixture set: pre-change sessions, mixed chains, 0.7.0-era files; idempotent re-open | Codex | Done | WS-03, WS-04 | Frozen synthetic pre-change/mixed/v1 shapes; real Pi double-open, resume semantics, exact fork, migration, append tests |
| WS-06 | Prompt updates for compaction aux-agent and subagent report emission | Codex | In progress | WS-01, WS-02 | Prompt tests pass; real-vault compaction/subagent checks remain |

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

### 2026-07-16 — Host-neutral continuation schemas — Codex

- Changed: added versioned `Checkpoint` and `AgentReport` contracts, tolerant parsers, deterministic checkpoint-ledger merging, fenced report extraction/formatting, and a cross-platform absolute-device-path rejection boundary under the public core session namespace.
- Evidence: focused schema suite passes 18 tests; root source/test typechecks and ESLint pass. Installed Pi 0.80.6 exposes `CompactionEntry.details` and a public fourth `appendCompaction` argument, so structured checkpoint storage needs neither a second entry nor private API use.
- Problems recorded: the repository has no checked-in historical session JSONL fixtures; the existing “0.7.0” evidence is synthetic migration input. WS-05 will add frozen pre-change-shaped fixtures and label their provenance accurately rather than claiming unavailable historical bytes.
- Remaining: writer/context integration, report delivery/reload/privacy integration, fixtures, prompts, docs, and full/manual gates.
- Blockers: none.
- Next action: wire checkpoint creation/merge into compaction and verify legacy summary/context behavior before the next commit.

### 2026-07-16 — Checkpoint compaction integration — Codex

- Changed: compaction prompts now request the complete deterministic checkpoint section set; valid output becomes a checkpoint in `compaction.details.piviCheckpoint`, durable decisions/artifacts merge across chains, and the merged checkpoint is rendered back into the legacy summary consumed by Pi. Invalid sections or device-local artifact paths keep the original summary and omit details.
- Evidence: 5 focused suites / 82 tests pass with root typecheck, ESLint, and all boundary/spec checks. The real installed Pi integration proves prior JSONL bytes remain exact prefixes, details survive reopen, leaf identity remains the compaction entry, and unmodified context construction consumes only the summary.
- Problems recorded: prompt-section parsing intentionally requires all eight headings; providers that do not comply take the documented summary-only compatibility path instead of persisting a partial checkpoint.
- Remaining: Agent report delivery/reload/privacy integration, frozen compatibility fixtures, documentation, manual validation, and full gate.
- Blockers: none.
- Next action: separate compact parent reports from raw terminal/UI traces for both blocking and background subagents.

### 2026-07-16 — Structured parent report integration — Codex

- Changed: blocking and background `spawn_agent` share one report-emission prompt and tolerant extraction point. Valid reports are status-corrected by the runtime and compacted for parent context; the complete terminal result remains in structured tool details for the visible trace. Invalid output remains byte-for-byte text behavior. Persisted background completion rewrites use valid reports when available, and the legacy JSONL reader gained a report extractor without changing its text API.
- Evidence: 6 focused suites / 103 tests pass plus root typecheck, ESLint, and boundaries. Coverage includes all four outcomes at schema level, blocking/background delivery, raw-terminal UI preference, persisted reload rewrite, malformed fallback, and removal of an Agent report containing POSIX absolute artifact paths while retaining unrelated legacy details.
- Problems recorded: current Pi background jobs are in-memory and do not write a separate subagent JSONL; `subagentJsonl.ts` is a legacy/external output reader. The spec's original wording overstated that path, so implementation composes the reader for compatibility but keeps the live extraction at `createSubagentTool`.
- Remaining: frozen old/mixed fixtures, real-vault checks, docs/guidance, full gate, and archive.
- Blockers: none.
- Next action: add provenance-labeled frozen pre-change/mixed fixtures and prove idempotent open/resume/fork compatibility.

### 2026-07-16 — Frozen session compatibility matrix — Codex

- Changed: added immutable synthetic fixtures for pre-checkpoint v3 compaction, a mixed legacy/structured chain, and Pi's legacy-v1 compaction-index migration shape, with an explicit provenance README. A real installed-Pi subprocess copies them to a temporary directory and verifies double-open idempotence, summary-only context compatibility, checkpoint detail preservation, exact-leaf forks, v1-to-v3 migration, and resumed context.
- Evidence: both real-Pi integration suites pass; root typecheck and ESLint pass. Current append compatibility also proves checkpoint details preserve all prior bytes and survive reopen without entering Pi's model context separately.
- Problems recorded: no provenance-verifiable Pivi 0.7.0 JSONL bytes exist in the repository. The success criterion's “0.7.0-era” label is satisfied only as a documented legacy v1 shape contract; the fixture README prohibits presenting it as a captured historical session.
- Remaining: real-vault compaction and blocking/background report checks, durable docs/guidance, full gate, archive.
- Blockers: none.
- Next action: commit the compatibility matrix, then update durable documentation before running the production/manual gate.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated.
