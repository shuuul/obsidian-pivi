---
id: "035"
title: "Skills and MCP extension safety"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 035 — Skills and MCP extension safety

## Context

Vault Skills and MCP servers are user-installed extensions to the agent's behavior. Skills installation currently invokes dynamically resolved `npx skills`, uses `shell: true` on Windows, performs synchronous filesystem traversal/copy, replaces an existing destination by deleting it first, and loads `SKILL.md` without a realpath/symlink containment check. A failed update can therefore lose the old skill, and a symlink can make prompt content originate outside the staged root.

MCP tool calls currently accumulate text/resource output without a shared block/byte/depth budget. The server configuration UI can expose command and environment metadata after spec `030`, but extension provenance, enable-time confirmation, output quarantine, and large-result artifact handling remain undefined.

This is the sixth review-hardening spec. It depends on the safe process/filesystem primitive from spec `033` and consumes capability authorization from spec `034`.

## Goal and success criteria

Treat Skills and MCP servers as explicit extensions with pinned tooling, transactional installation, bounded output, provenance, and capability-aware activation.

- [ ] The Skills distribution CLI is an exact dependency/version verified by the lockfile; runtime never downloads an implicit latest CLI.
- [ ] Skills commands run with `shell: false` through the safe process runner on every platform, including explicit Windows executable resolution.
- [ ] Source grammar is strict and provenance records the normalized source plus immutable commit/digest when available.
- [ ] Installation/update occurs in a temporary staged root; every entry is lstat/realpath checked, symlinks and path escapes are rejected, and file-count/per-file/total-size limits apply.
- [ ] A staged skill must contain a valid bounded `SKILL.md`; invalid frontmatter/encoding/content fails loudly.
- [ ] Replacement uses atomic rename/swap semantics and preserves the old version until the new tree is validated and published.
- [ ] Filesystem work is asynchronous or moved off latency-sensitive renderer paths.
- [ ] Installation/update UI previews source, version/commit, file list, size, skill diff, and requested activation; new remote Skills remain disabled until confirmed.
- [ ] Enabling a new stdio MCP server previews executable, arguments, cwd, environment names, auth mode, and capability implications without exposing values.
- [ ] MCP tool results enforce maximum blocks, encoded bytes, text characters, JSON depth, and resource count before session/context persistence.
- [ ] Oversized MCP results are rejected or written to a bounded Vault-local artifact with a summary/reference under capability policy; they are never silently truncated into misleading success.
- [ ] Installed/updated extension failures leave no partial active extension and no orphan process.

## Scope and non-goals

In scope:

- Skills CLI dependency/version, source parsing, staging, validation, provenance, atomic publication, async filesystem work, and UI preview.
- Runtime Skill loader containment and size validation.
- MCP enable-time execution preview and activation policy integration.
- MCP result budgets, artifact/reference strategy, persistence behavior, and UI disclosure.
- Migration of existing Skills metadata where reliable provenance exists.

Not in scope:

- Semantically proving that Skill instructions or MCP results are trustworthy.
- Mirroring third-party repositories or building a package registry.
- General process runner or approval infrastructure; specs `033` and `034`.
- Grouping sibling subagents or changing subagent-card presentation.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Pin the Skills CLI as a normal exact dependency and invoke its known executable directly. | `npx` latest resolution makes reviewed code differ from executed code. | WS-01 |
| 2026-07-23 | Reject all symlinks in staged Skills rather than attempting selective following. | Skill bundles are small and do not need symlink semantics; rejection gives a clear containment invariant. | WS-02 |
| 2026-07-23 | Validate a complete staged tree before atomically replacing the old tree. | Delete-then-copy makes interruption destructive and exposes partial prompt content. | WS-02 |
| 2026-07-23 | Keep large MCP output out of session/context unless it passes explicit budgets. | A configured or compromised server must not exhaust renderer memory or model context. | WS-04 |
| 2026-07-23 | New remote Skills and stdio MCP definitions require explicit activation after provenance/execution preview. | Installation/configuration is not equivalent to granting runtime authority. | WS-03 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Pin and directly invoke the Skills CLI with strict source parsing and provenance capture | Unassigned | Pending | Spec 033 completed | Dependency, source grammar, executable, offline tests |
| WS-02 | Implement staged async tree validation, symlink rejection, limits, and atomic replace/rollback | Unassigned | Pending | WS-01 | Temporary-filesystem fault-injection tests |
| WS-03 | Add localized provenance/diff and MCP execution previews plus explicit capability-aware activation | Unassigned | Pending | Spec 034 completed, WS-01 | React accessibility and approval lifecycle tests |
| WS-04 | Add MCP result budgets, bounded artifact/reference behavior, and persistence/rendering integration | Unassigned | Pending | Specs 032–034 completed | Oversize/depth/block/resource/context tests |
| WS-05 | Migration, docs/guidance, full gates, build, and live installation/MCP validation | Unassigned | Pending | WS-01–WS-04 | Full matrix and Obsidian runtime evidence |

## Verification

Required Skills cases:

- Offline execution uses the pinned installed CLI and never requests a registry package.
- Malicious source strings, Windows metacharacters, options disguised as source, and unexpected protocols are rejected before process execution.
- File, directory, and `SKILL.md` symlinks; junctions/reparse points where applicable; traversal names; oversized files/tree; invalid UTF-8; and malformed frontmatter fail staging.
- Failure before/during publication leaves the prior active skill byte-identical and the staged tree recoverable/cleanable.
- Successful update preserves disabled state intentionally and records new provenance/diff.

Required MCP cases:

- New stdio server remains inactive until its exact command/args/cwd/env names are confirmed.
- Huge text, many blocks, deeply nested JSON/resource, binary-like content, infinite/streamed output, and output near each limit have deterministic outcomes.
- Artifact fallback uses a bounded validated Vault-relative path, exposes a clear summary, and respects the capability decision.
- Rejected/oversized result does not enter model context or session JSONL as the full payload.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/skills
npm run test -- --runInBand tests/unit/mcp
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

- Numbered developer docs: `docs/07-tools-skills-mcp-and-integrations.md` and `docs/09-development-debugging-and-validation.md`.
- Nearest local guidance: nearest Skills/MCP guidance plus `packages/pivi-react/src/i18n/AGENTS.md`.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/pivi-react/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Combined executable Skill installation hardening with bounded MCP extension activation/output behavior.
- Evidence: Current `VaultSkillsService`, `loadVaultSkills`, process environment helpers, MCP bridge/result accumulation, and review findings.
- Remaining: Complete prerequisite process/capability specs and execute WS-01 through WS-05.
- Blockers: Specs `033` and `034` provide the execution and authorization contracts this spec must use.
- Next action: After prerequisites, freeze CLI/version and staged-tree formats before implementation.

## Completion summary

Pending.
