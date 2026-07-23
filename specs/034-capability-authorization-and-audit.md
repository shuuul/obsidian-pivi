---
id: "034"
title: "Capability authorization and audit"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 034 — Capability authorization and audit

## Context

Pivi combines Vault reads/writes, network access, external file reads, MCP calls, local processes, and credentials in one model-driven runtime. Individual toggles exist for Bash, external reads, CLI, and some tool settings, but there is no shared capability vocabulary, turn-scoped grant model, high-risk confirmation boundary, or structured audit trail. Prompt instructions that label external content untrusted are useful model guidance, not an enforcement boundary.

Specs `030`–`033` first make storage, network, process, and path primitives safe and explicit. This fifth spec composes those primitives into product policy. It must not introduce a generic approval wrapper that merely forwards calls: authorization belongs at typed capability boundaries with normalized resource summaries.

## Goal and success criteria

Ensure every high-authority operation is classified, authorized at the correct scope, and recorded without leaking content or secrets.

- [ ] One canonical capability model covers `read-only`, `current-note-write`, `vault-write`, `destructive-write`, `network`, `external-files`, and `local-process`.
- [ ] Tool registration and runtime execution both enforce capability availability; hiding UI or prompt text is never the only gate.
- [ ] Default profiles are explicit and documented; migration never silently grants more authority than the prior effective configuration.
- [ ] Turn-scoped confirmation applies to destructive writes, existing-file overwrite, high-file-count/bulk mutation, new network origins, new stdio server launch, Bash/eval, and sensitive/large payload transmission to MCP.
- [ ] Approval previews use normalized paths/origins/server/tool/executable metadata and never include secret values or unnecessary document bodies.
- [ ] Grants are bound to session, turn, capability, resource, and operation shape; replay or widening requires a new approval.
- [ ] Denial, timeout, cancellation, view disposal, plugin unload, and session switch fail closed and leave no pending execution.
- [ ] Background subagents cannot inherit broader authority than the parent turn and cannot present their own hidden approval UI.
- [ ] A structured audit log records timestamp, session identity, tool, normalized paths/origin/MCP server/tool/process command, approval source, and result while redacting secrets and sensitive URL queries.
- [ ] Audit retention, location, size bounds, rotation, user inspection, and deletion are explicit.
- [ ] Prompt-injection regression scenarios prove that untrusted web/MCP/Vault content cannot bypass policy by requesting another tool.
- [ ] Main window, pop-out, multi-view, queued turn, inline edit, and restored session behavior is deterministic.

## Scope and non-goals

In scope:

- Core capability/resource/decision contracts and policy evaluator.
- Settings profiles and migration from existing toggles.
- App-owned approval orchestration and React presentation ports.
- Integration into tool registration/execution, network origin grants, mutation/process/MCP boundaries, inline edit, and subagents.
- Redacted bounded audit persistence and user inspection.
- Accessibility, owner-realm, lifecycle, and adversarial tests.

Not in scope:

- Replacing the safe primitives established by specs `030`–`033`.
- Attempting to detect prompt injection semantically.
- OS-level sandboxing or enterprise policy management.
- Uploading audit logs or telemetry.
- Permanent wildcard grants for all origins/processes/destructive operations.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Evaluate typed capabilities and normalized resources in core; render approvals through app-owned presentation ports. | Policy must remain host-neutral while approval UI remains an Obsidian composition concern. | WS-01, WS-03 |
| 2026-07-23 | Grants are narrow, turn-scoped, and fail closed on lifecycle changes. | Long-lived broad grants amplify indirect prompt injection and stale UI state. | WS-01, WS-02 |
| 2026-07-23 | Enforce at execution boundaries in addition to tool availability. | A stale tool registry, restored turn, or indirect caller must not bypass current policy. | WS-02 |
| 2026-07-23 | Store metadata-only audit records with strict redaction/rotation. | Auditing must not become a second store for Vault content, secrets, or signed URLs. | WS-04 |
| 2026-07-23 | Subagents inherit the intersection of parent authorization and their declared task needs. | Delegation cannot escalate authority or create invisible approval surfaces. | WS-02, WS-03 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define capability profiles, normalized resources, grant scopes, evaluator, and migration semantics | Unassigned | Pending | Specs 030–033 completed | Pure policy table and migration tests |
| WS-02 | Enforce policy in tool/runtime/network/mutation/process/MCP/subagent boundaries | Unassigned | Pending | WS-01 | Direct and indirect bypass regression tests |
| WS-03 | Build localized accessible approval UX through presentation ports with lifecycle cancellation | Unassigned | Pending | WS-01 | Main/pop-out/multi-view/keyboard/screen-reader tests |
| WS-04 | Implement redacted bounded audit store, inspection, rotation, and deletion | Unassigned | Pending | WS-01, WS-02 | Redaction, concurrency, retention, corruption tests |
| WS-05 | Adversarial scenarios, docs/threat model, full gates, build, and live host validation | Unassigned | Pending | WS-01–WS-04 | Prompt-injection matrix and Obsidian evidence |

## Verification

Policy table tests must cover every combination of profile, capability, operation risk, resource scope, and grant state. Required end-to-end scenarios:

- Web content instructs the agent to read a private note and send it to a new origin.
- MCP output asks the agent to start another stdio server or invoke Bash.
- A Vault note asks for bulk deletion/move/overwrite.
- A subagent attempts a capability unavailable to the parent turn.
- A previously approved origin/path is changed by redirect, symlink, rename, tool argument mutation, or session switch.
- Approval is accepted, denied, timed out, cancelled, interrupted, view-disposed, plugin-unloaded, and restored after crash.
- One approval authorizes exactly the previewed operation and does not authorize a sibling tool or later turn.
- Audit records contain normalized metadata and decision/result but no content body, header value, environment value, credential, authorization code, or sensitive query.
- Audit rotation remains bounded and user deletion removes only the intended audit files.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi
npm run test -- --runInBand tests/unit/app
npm run test -- --runInBand tests/pivi-react
npm run test -- --runInBand tests/integration
npm run check:architecture
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, `docs/04-input-panel-and-context.md`, `docs/06-subagents-streaming-and-rendering.md`, and `docs/07-tools-skills-mcp-and-integrations.md`.
- Nearest local guidance: `src/app/AGENTS.md`, `src/ui/AGENTS.md`, `src/ui/chat/AGENTS.md`, `packages/pivi-react/AGENTS.md`, and affected feature guidance.
- Parent/package guidance: all affected package `AGENTS.md` files, especially core runtime/tools, host, tools, and React presentation.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Converted the review's approval/capability recommendation into an enforcement and lifecycle contract that depends on hardened primitives.
- Evidence: Current tool toggles/settings, runtime registration/execution paths, subagent architecture, and review threat scenarios.
- Remaining: Complete prerequisite specs, decide default profiles/migration, and execute WS-01 through WS-05.
- Blockers: Network/resource/process/path summaries must be canonical and safe under specs `032` and `033`.
- Next action: After prerequisites, activate this spec and first freeze the policy decision table before building UI.

## Completion summary

Pending.
