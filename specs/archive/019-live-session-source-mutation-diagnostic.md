---
id: "019"
title: "Live session source mutation diagnostic"
status: Completed
created: 2026-07-19
updated: 2026-07-19
coordinator: "Codex"
---

# 019 — Live session source mutation diagnostic

## Context

While preparing README screenshots in the disposable `example` vault, a real Pivi turn surfaced `Live session source changed before mutation`. The error must be traced to its owning runtime/session invariant before screenshot work continues.

## Goal and success criteria

Identify the exact trigger, affected mutation, and whether the behavior is an intended concurrency guard or a product bug.

- [x] Reproduce or recover the error from the example-vault session and console evidence.
- [x] Map the error string to its source, callers, and guarded state.
- [x] State the root cause and the smallest safe remediation direction without changing implementation.

## Scope and non-goals

In scope:

- Example-vault runtime evidence and the session mutation path.
- Read-only code and test inspection.

Not in scope:

- Implementing a fix.
- Continuing screenshot production before the diagnostic is reported.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-19 | Diagnose read-only before modifying runtime code | The user asked for a subagent investigation, not a fix | WS-01, WS-02 |
| 2026-07-19 | Treat the JSONL replacement as proven and its external actor as unproven | The sidecar records a larger source with a different inode, while the current file is an older prefix; no captured log identifies the replacing process | WS-01, WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Trace source, callers, invariants, and tests | `live_session_trace` | Done | None | Repository search with file/line evidence |
| WS-02 | Capture example-vault session and runtime evidence | Coordinator | Done | None | CLI console, DOM, JSONL, and file metadata |

## Verification

- `rg -n "Live session source changed before mutation" src packages tests`
- `obsidian vault=example dev:console`
- Inspect `.pivi/sessions/*.jsonl` and related index/tab state without changing them.
- `npm run check:specs`

## Documentation sync

- Numbered developer docs: `docs/10-roadmap-release-and-maintenance.md` records the accepted iCloud/cloud-file recovery follow-up without claiming it is implemented.
- Nearest local guidance: None; diagnosis does not change a seam.
- Parent/package guidance: None.
- Root guidance and roadmap: No `AGENTS.md` change; the technical roadmap owns the pending product work.

## Progress and handoff

### 2026-07-19 — Codex — WS-02

- Changed: Paused screenshot work, inspected the live turn, JSONL, sidecar, tab state, console, and filesystem identity.
- Evidence: The sidecar's final checkpoint records size 3344 and inode 79703858, while the current JSONL at the same path is size 2300 and inode 79704533. The current 2300-byte file is the exact earlier prefix ending at the model-generated session title. The vault is located under iCloud Drive.
- Remaining: None for diagnosis. Identifying the external replacing process would require a new instrumented reproduction.
- Blockers: None.
- Next action: Report the evidence boundary and remediation direction.

### 2026-07-19 — `live_session_trace` — WS-01

- Changed: Read-only trace of the fingerprint guard, live mutation callers, migration path, and unit coverage.
- Evidence: `assertSessionJsonlSourceUnchanged()` compares size, device, inode, nanosecond mtime, and head/tail hashes; every live append/truncate/fork validates it and evicts stale state on mismatch.
- Remaining: None.
- Blockers: None.
- Next action: Reconcile the generic caller map with the example-vault file evidence.

## Completion summary

The diagnostic confirmed that the user-facing error is an intentional stale-write guard. During the example-vault turn, the session file previously grew to 3344 bytes on inode 79703858, then the same path presented an older 2300-byte prefix on inode 79704533. Pivi correctly refused a later mutation rather than writing through a replaced source. The captured evidence does not identify the replacing process; the vault's iCloud Drive location makes File Provider replacement a plausible external cause, while a Pivi migration rewrite is not supported by this session's already-complete migration marker and brand-new lifecycle. No runtime code or durable behavior was changed. The roadmap now tracks device-local journaling, explicit recovery, and local rebuildable indexes as the follow-up required for a stronger iCloud compatibility guarantee.
