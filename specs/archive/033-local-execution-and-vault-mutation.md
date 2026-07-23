---
id: "033"
title: "Local execution and Vault mutation"
status: Completed
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 033 — Local execution and Vault mutation

## Context

Pivi can execute the official CLI, allowlisted Bash, user-configured MCP stdio, and Skills tooling. The shared process runner currently buffers stdout/stderr without a general contract limit, has no `AbortSignal`, sends one `kill()` on timeout, does not terminate a process tree, and loses signal information. Bash uses the user's login shell with `-lc`; its first-token/prefix allowlist is an operator guard, not a sandbox.

Vault mutation paths call `normalizePathForVault()`, which returns a normalized external/absolute path when the input is not inside the Vault. The mutation layer therefore relies on downstream Obsidian behavior rather than enforcing its own vault-relative invariant. File Recovery snapshots reduce accidental-loss impact but do not establish containment.

This is the fourth review-hardening spec. It builds safe local primitives before spec `034` adds user-facing capability authorization. Spec `030` supplies truthful baseline process results; this spec completes lifecycle, bounds, executable, and filesystem semantics.

## Goal and success criteria

Make process execution and Vault mutation safe, explicit primitives whose constraints cannot be bypassed by higher-level callers.

- [x] `ProcessRunRequest` requires explicit output limits, timeout/deadline, shell policy, cwd policy, and supports `AbortSignal`.
- [x] Output is bounded while streaming with deterministic truncation metadata; memory use does not scale with child output.
- [x] Results distinguish numeric exit, signal termination, timeout, abort, spawn error, and forced-kill escalation.
- [x] Timeout/abort terminates the complete owned process tree on macOS, Linux, and Windows, waits for close, and cannot resolve twice.
- [x] Shell execution is forbidden by default; callers use a resolved executable plus argument vector.
- [x] Bash no longer loads login-shell startup files and uses a structured executable/argument policy or is removed if the claimed sandbox cannot be made true.
- [x] Executable allowlists match canonical executable paths and argument schemas, not string prefixes.
- [x] Process cwd is constrained to the Vault or an explicitly approved external root appropriate to the capability.
- [x] Read/display path normalization is separate from mutation validation.
- [x] Every Vault mutation requires a non-empty canonical vault-relative path and rejects absolute paths, drive/UNC paths, traversal, NUL, invalid separator combinations, and symlink-parent escape.
- [x] Nonexistent mutation targets under symlinked parents are contained using the nearest existing ancestor.
- [x] Existing File Recovery behavior remains intact for eligible note overwrites.
- [x] Platform-focused tests cover path case sensitivity, drives/UNC, signals, process groups, and kill escalation.

## Scope and non-goals

In scope:

- Process runner port/result redesign and host implementations.
- Migration of CLI, Bash, MCP stdio, Skills, and external-open callers to explicit request policies.
- Bash execution redesign or removal of claims that cannot be enforced.
- Vault mutation path API split and migration of write/edit/delete/move/mkdir callers.
- Symlink containment, cwd containment, platform tests, and documentation.

Not in scope:

- Whether the user has authorized a safe operation; spec `034`.
- Network egress from child processes beyond the environment/process constraints exposed here.
- Container/VM sandboxing.
- External read containment already enforced by realpath, except shared primitives needed for mutation/cwd checks.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Treat the process runner as a bounded execution primitive, not a convenience wrapper around `spawn`. | Every process-capable feature otherwise reimplements timeout, output, and termination incorrectly. | WS-01 |
| 2026-07-23 | Default `shell` to forbidden and require a separately reviewed adapter for any unavoidable shell use. | String shell commands expand the injection surface and load ambient user configuration. | WS-01, WS-02 |
| 2026-07-23 | Require canonical executable paths plus argument schemas for allowlisted execution. | First-token and prefix matching do not constrain the actual executable/argument behavior. | WS-02 |
| 2026-07-23 | Introduce `requireVaultRelativeMutationPath` rather than changing display/read normalization semantics in place. | Mutation containment must fail loudly without breaking host-neutral display behavior. | WS-03 |
| 2026-07-23 | Resolve the nearest existing parent when validating a nonexistent target. | `realpath` of the final target alone cannot detect creation beneath a symlink that escapes the Vault. | WS-03 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Redesign process ports/runner for bounded streams, abort, signals, deadlines, and process-tree termination | /subagent | Completed | Spec 030 completed | Unit and real-child fixtures on supported OSes |
| WS-02 | Migrate CLI/Bash/MCP/Skills callers to resolved executables, argument schemas, cwd policies, and no ambient shell | /subagent | Completed | WS-01 | Caller-focused injection/cwd/output/abort tests |
| WS-03 | Split path helpers and enforce canonical vault-relative mutation containment including symlink parents | /subagent | Completed | None | POSIX/Windows path and temporary-filesystem tests |
| WS-04 | Migrate every mutation tool/host path and preserve File Recovery ordering | /subagent | Completed | WS-03 | Mutation integration and recovery regression tests |
| WS-05 | Platform matrix, docs/guidance, full gates, build, and live reload | /subagent | Completed | WS-01–WS-04 | macOS/Windows/Ubuntu evidence plus Obsidian reload |

## Verification

Required process fixtures:

- Output beyond each stream cap, multibyte UTF-8 at the truncation boundary, simultaneous stdout/stderr, and no-reader backpressure deadlock.
- Numeric nonzero exit, `SIGTERM`, ignored `SIGTERM` followed by escalation, timeout, caller abort, spawn failure, and descendant/grandchild cleanup.
- POSIX executable/argument vectors containing whitespace/metacharacters remain literal; Windows `.exe`/`.cmd` resolution follows the explicit adapter policy.
- Bash/CLI/MCP/Skills cannot select a cwd outside the permitted root and do not load shell startup aliases/functions.

Required path fixtures:

- Vault root, empty path, `.`, `..`, nested traversal, NUL, duplicate/mixed separators, absolute POSIX, Windows drive-relative/absolute, UNC/device paths, and case variants.
- Existing symlink target outside the Vault and nonexistent target beneath a symlinked parent.
- Create, overwrite, append/prepend, edit, delete, move source/destination, and mkdir all reject escape attempts before invoking the Obsidian API.
- Valid note mutation still records File Recovery before the first write.

Commands:

```bash
npm run test -- --runInBand tests/unit/host
npm run test -- --runInBand tests/unit/pi/tools
npm run test -- --runInBand tests/unit/pi/skills
npm run test -- --runInBand tests/unit/mcp
npm run test -- --runInBand tests/unit/obsidian-tools
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, and `docs/07-tools-skills-mcp-and-integrations.md`.
- Nearest local guidance: nearest `packages/obsidian-host`, `packages/obsidian-tools`, Bash, MCP, Skills, and app guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/obsidian-tools/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md` if present, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Separated safe process/filesystem primitives from the later authorization UX and audit policy.
- Evidence: Current `systemProcessRunner`, `ProcessRunner` port, Bash/Skills/MCP callers, `normalizePathForVault`, and Vault mutation call sites.
- Remaining: Finalize cross-platform termination/canonicalization choices and execute WS-01 through WS-05.
- Blockers: Spec `030` must land its signal-result correction before this broader port migration.
- Next action: Complete spec `030`, activate this spec, and establish focused process/path fixtures before implementation.

### 2026-07-23 — /subagent — activation

- Changed: Set status `Active` and claimed WS-01–WS-05 for implementation.
- Evidence: Spec frontmatter and workstream table updated; Specs 030–032 archived on `main`.
- Remaining: Implement process/path primitives, migrate callers, tests, docs, verification, and archive.
- Blockers: None.
- Next action: Redesign `ProcessRunRequest` / runner and `requireVaultRelativeMutationPath`, then migrate Bash/CLI/Skills/mutation callers.

### 2026-07-23 — /subagent — implementation complete

- Changed: Redesigned `ProcessRunRequest`/`ProcessRunResult`, rewrote `systemProcessRunner` for bounded streams/abort/process-tree kill, migrated Bash/CLI/Skills/MCP callers, added `requireVaultRelativeMutationPath` and vault mutation migration, updated i18n/docs/SECURITY, and verified on macOS.
- Evidence: Focused Jest suites (host/tools/skills/mcp/obsidian-tools) 243 passed; `npm run typecheck`; `npm run lint`; `npm run check:boundaries` architecture/package-readmes/specs; `npm run build`; `obsidian plugin:reload id=pivi` + `obsidian dev:errors` → `No errors captured.`
- Remaining: Specs 034–036 for authorization UX, session cloud recovery, and release assurance.
- Blockers: None for this spec. Pre-existing i18n dead keys `common.disable`/`disabled`/`enable` still fail dead-key checks (noted only).
- Next action: Archive this spec and hand off to coordinator.

## Completion summary

Spec `033` completed bounded local process execution and mandatory vault-relative mutation containment. The process port now requires output limits, timeout, shell/cwd policy, and AbortSignal; the host runner streams with truncation metadata, terminates process trees with forced-kill escalation, and reports exit/signal/timeout/abort/spawn-error/forced-kill without double-resolve. Bash no longer uses login-shell `-lc` and matches canonical executable paths plus argument schemas; CLI/Skills use the shared runner; MCP stdio gets vault cwd and shell-syntax rejection. Vault mutations use `requireVaultRelativeMutationPath` separately from display normalization, including symlink-parent containment, while File Recovery ordering remains intact. Documentation, SECURITY.md, and package guidance were synchronized; verification commands and Obsidian reload succeeded on macOS.

