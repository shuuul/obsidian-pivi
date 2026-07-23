---
id: "034"
title: "High-risk operations and extensions"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 034 — High-risk operations and extensions

## Context

After specs `030`–`033`, Pivi's credential, network, process, and Vault-mutation primitives will have explicit safety boundaries. The remaining product risk is that a model can still invoke a safe primitive at the wrong time because untrusted Vault, web, Skill, or MCP content instructed it to do so.

Pivi also installs remote Skills through a dynamically resolved `npx skills` command and accepts user-configured MCP extensions. Skills can change agent behavior; stdio MCP can execute local programs; MCP results can consume unbounded memory and model context. These extension paths need a small enforceable activation boundary.

## Goal and success criteria

Require explicit authorization for the small set of highest-risk operations and make installed Skills/MCP extensions transactional and resource-bounded.

- [ ] Delete, overwrite of an existing file, bulk mutation above one documented threshold, Bash/eval, and first launch of a configured stdio MCP server require a turn-scoped confirmation.
- [ ] A confirmation is bound to the current session, turn, operation kind, and normalized resource summary; changing arguments or switching session requires a new confirmation.
- [ ] Denial, cancellation, timeout, view disposal, session switch, and plugin unload fail closed and leave no pending execution.
- [ ] Subagents cannot receive broader authority than the parent turn and cannot open hidden approval flows.
- [ ] Approval previews show normalized paths, executable/arguments, MCP server/tool, and destination origin metadata without secret values or document bodies.
- [ ] A minimal bounded audit record captures the decision and outcome metadata needed to diagnose an operation; it has a fixed retention/size limit and contains no content, credentials, headers, environment values, authorization codes, or sensitive URL queries.
- [ ] The Skills CLI is an exact installed dependency; runtime never resolves an implicit latest package.
- [ ] Skills commands use the safe process runner with `shell: false` on every supported platform.
- [ ] Skill install/update validates a temporary staged tree, rejects symlinks and path escapes, enforces file-count/per-file/total-size limits, requires a valid bounded `SKILL.md`, and atomically replaces the prior version only after validation succeeds.
- [ ] A failed Skill install/update leaves the previous installed version unchanged and active state unchanged.
- [ ] New stdio MCP definitions remain inactive until the exact executable, arguments, cwd, and environment variable names are confirmed.
- [ ] MCP results enforce maximum block count, encoded bytes, text characters, JSON depth, and resource count before entering model context or session persistence.
- [ ] Oversized MCP results fail explicitly or produce a bounded Vault-local artifact reference after authorization; full oversized payloads never enter JSONL/context.

## Scope and non-goals

In scope:

- One fixed high-risk operation list and turn-scoped confirmation evaluator.
- App-owned localized confirmation UI and lifecycle cancellation.
- Minimal redacted bounded audit records for confirmed/denied high-risk operations.
- Exact Skills CLI invocation, staged validation, symlink rejection, limits, and atomic publication.
- Stdio MCP activation preview and MCP result budgets.
- Integration with safe primitives from specs `030`–`033`.

Not in scope:

- Per-network-origin confirmation already owned by the egress policy in spec `032`.
- Semantic classification of prompt injection.
- OS-level sandboxing.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Use one fixed high-risk operation table. | The immediate requirement is preventing unintended destructive/process execution. | WS-01 |
| 2026-07-23 | Bind approvals narrowly to turn, operation, and normalized resources and invalidate them on lifecycle changes. | A broad or persistent grant amplifies indirect prompt injection. | WS-01, WS-02 |
| 2026-07-23 | Keep audit records metadata-only, size-bounded, and internal to diagnostics. | Auditing must not create another sensitive-content store. | WS-02 |
| 2026-07-23 | Pin and directly invoke the Skills CLI, reject staged symlinks, and publish only a completely validated tree. | Executed installer code and prompt content must match the reviewed, contained source. | WS-03 |
| 2026-07-23 | Keep large MCP output out of context/session before materialization crosses fixed budgets. | Truncating after accumulation does not protect memory or preserve truthful result semantics. | WS-04 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define the fixed high-risk operation table, narrow grant key, evaluator, and fail-closed lifecycle | Unassigned | Pending | Specs 030–033 completed | Pure decision table, argument-change, and lifecycle tests |
| WS-02 | Add localized approval presentation and minimal redacted bounded audit records | Unassigned | Pending | WS-01 | Main/pop-out, accessibility, cancellation, retention, and redaction tests |
| WS-03 | Pin Skills CLI and implement shell-free staged validation plus atomic replace/rollback | Unassigned | Pending | Spec 033 completed | Offline invocation and temporary-filesystem fault tests |
| WS-04 | Add stdio activation preview and MCP result budgets before context/session persistence | Unassigned | Pending | WS-01; specs 031–033 completed | Fake process/MCP oversize/depth/resource tests |
| WS-05 | Adversarial scenarios, docs/guidance, full gates, build, and live host validation | Unassigned | Pending | WS-01–WS-04 | End-to-end matrix and Obsidian runtime evidence |

## Verification

Required authorization scenarios:

- Untrusted Vault, web, Skill, or MCP text requests delete, overwrite, bulk mutation, Bash/eval, or stdio launch.
- Accepted authorization applies only to the previewed arguments and current turn.
- Denial, timeout, interruption, session switch, view disposal, and unload prevent execution.
- A subagent request outside the parent's authorization fails without hidden UI.
- Audit records contain only normalized decision/outcome metadata and remain under the fixed retention/byte budget.

Required Skills/MCP scenarios:

- Offline Skill installation uses the exact lockfile dependency and makes no registry resolution for a CLI package.
- Malicious source arguments, Windows metacharacters, symlinks/junctions, traversal, oversized trees, invalid encoding, and malformed `SKILL.md` fail before publication.
- Failure at every staging/publication boundary leaves the old Skill byte-identical.
- A new stdio MCP server starts zero processes before explicit confirmation.
- Huge text, many blocks/resources, deeply nested JSON, and streamed output stop at fixed budgets and do not enter context/session in full.
- Artifact fallback uses a validated bounded Vault-relative path and requires the applicable write confirmation.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/skills
npm run test -- --runInBand tests/unit/mcp
npm run test -- --runInBand tests/unit/app
npm run test -- --runInBand tests/pivi-react
npm run test -- --runInBand tests/integration
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/06-subagents-streaming-and-rendering.md`, `docs/07-tools-skills-mcp-and-integrations.md`, and `docs/08-presentation-and-settings.md`.
- Nearest local guidance: `src/app/AGENTS.md`, `src/ui/AGENTS.md`, nearest Skills/MCP guidance, and `packages/pivi-react/src/i18n/AGENTS.md`.
- Parent/package guidance: affected core, host, tools, and React package `AGENTS.md` files.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — scope reduction

- Changed: Consolidated high-risk confirmation, transactional Skill installation, stdio activation, and MCP result bounds into one execution contract.
- Evidence: Current high-risk tool paths, `VaultSkillsService`, MCP connection/result paths, and prerequisite specs `030`–`033`.
- Remaining: Freeze thresholds/limits, complete prerequisites, and execute WS-01 through WS-05.
- Blockers: Safe normalized process/path/network/config primitives from specs `030`–`033`.
- Next action: After prerequisites, set this spec Active and implement the fixed decision table before UI or extension integration.

## Completion summary

Pending.
