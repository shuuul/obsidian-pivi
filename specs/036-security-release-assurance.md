---
id: "036"
title: "Security and release assurance"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 036 — Security and release assurance

## Context

The three Pi packages use caret ranges while session code intentionally depends on isolated private Pi members. CI runs full gates on Ubuntu, whereas path/process/MCP stdio/Skills behavior is platform-sensitive. The release workflow rebuilds artifacts but does not run or depend on the complete CI quality gates, and privileged workflows reference third-party Actions through mutable major tags.

The security changes in specs `030`–`035` need durable regression evidence and a public disclosure/trust-boundary document.

## Goal and success criteria

Make dependency compatibility, security-critical behavior, and release publication reproducibly verifiable.

- [ ] All Pi packages use one exact synchronized version in root/workspace manifests and the lockfile.
- [ ] Private Pi API access remains isolated behind one explicit adapter/capability assertion with an actionable compatibility error.
- [ ] A focused compatibility suite must pass before the exact Pi version is updated.
- [ ] Ubuntu retains the full quality gates.
- [ ] macOS and Windows run focused path, process, MCP stdio, and Skills tests introduced by specs `030`–`034`; documented support claims do not exceed tested behavior.
- [ ] Security-critical modules from specs `030`–`034` have direct branch coverage thresholds that cannot be satisfied by unrelated UI tests.
- [ ] A deterministic real Obsidian/Electron smoke loads Pivi, opens the view, creates/restores a disposable session, mutates a disposable note, starts/stops a fake stdio server, unloads/reloads, and detects leaked processes or global fetch mutation.
- [ ] Release publication runs the same required typecheck, lint, boundaries, tests/coverage, build, and bundle-size gates as CI or requires verified success for the exact tag commit.
- [ ] Third-party Actions in privileged workflows are pinned to reviewed full commit SHAs and remain updateable through Dependabot.
- [ ] Root `SECURITY.md` documents supported versions, disclosure route, trust boundaries, capability/credential matrix, network flows, prompt-injection stance, and third-party Skills/MCP responsibility.

## Scope and non-goals

In scope:

- Exact Pi pins, private compatibility adapter/assertion, and focused upgrade tests.
- Focused macOS/Windows security-sensitive CI.
- Direct coverage thresholds for the new security boundaries.
- One real Obsidian/Electron lifecycle smoke.
- Shared/required CI and release gates plus SHA-pinned Actions.
- Root security disclosure and threat-boundary documentation.

Not in scope:

- Full Windows/Linux product support certification.
- Replacing GitHub Actions, Release Please, or the completed attestation policy.
- Performance benchmarks unrelated to a release/security regression.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Pin the Pi packages exactly and upgrade them as one tested unit. | Private API compatibility and package identity are version-sensitive. | WS-01 |
| 2026-07-23 | Keep private Pi access in one explicit adapter with startup assertions. | Missing upstream capabilities must fail clearly rather than corrupt session behavior. | WS-01 |
| 2026-07-23 | Keep full Ubuntu CI and add only focused macOS/Windows security-sensitive jobs. | This covers verified platform risks without claiming broad support or tripling every job. | WS-02 |
| 2026-07-23 | Make release publication depend on the same mandatory gate definition as CI. | A successful build alone does not prove the tag passed tests, types, lint, boundaries, or security coverage. | WS-03 |
| 2026-07-23 | Keep security documentation human-owned and limited to durable trust/disclosure facts. | A general prose-contract framework is not required to ship the security fixes. | WS-04 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Exact Pi pins, private adapter/assertion, and focused upgrade compatibility suite | Unassigned | Pending | Specs 030–035 completed | Manifest/lock invariant and forced-capability-failure tests |
| WS-02 | Focused macOS/Windows jobs, direct security branch thresholds, and deterministic fixtures | Unassigned | Pending | Specs 030–034 completed | CI matrix evidence |
| WS-03 | Real host lifecycle smoke, shared CI/release gates, and SHA-pinned Actions | Unassigned | Pending | WS-02 | Smoke artifact and failing-gate publication test |
| WS-04 | `SECURITY.md`, durable guidance, full verification, and closeout | Unassigned | Pending | WS-01–WS-03 | Documentation audit and complete gates |

## Verification

Required evidence:

- A repository check fails on Pi version ranges or mismatches.
- A fake Pi manager missing each required private capability fails before session mutation with an actionable message.
- Focused platform jobs cover drive/UNC/symlink containment, process signals/tree termination, stdio executable discovery, and staged Skill installation.
- Security modules meet their dedicated branch thresholds without exclusions added solely to pass coverage.
- Real-host smoke proves session restore, disposable note mutation/recovery, fake stdio cleanup, unchanged original `window.fetch`, and zero captured runtime errors.
- A release cannot publish when any required shared gate fails for the exact tag commit.
- Workflow Action references are full SHAs and Dependabot covers their updates.
- `SECURITY.md` contains no unsupported security guarantee and matches the implemented defaults/storage/network/extension boundaries.

Commands:

```bash
npm ci
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
npm run check:bundle-size
npm run check:specs
```

Any new platform/smoke command must be documented in `package.json`, `AGENTS.md`, and `docs/09-development-debugging-and-validation.md`.

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, `docs/09-development-debugging-and-validation.md`, and `docs/10-roadmap-release-and-maintenance.md`.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, `tests/AGENTS.md`, `scripts/AGENTS.md`, and affected workflow/package guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` and packages affected by platform tests.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, new `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — scope reduction

- Changed: Narrowed the assurance phase to Pi compatibility, focused security tests, one host smoke, release gates, and disclosure documentation.
- Evidence: Current Pi ranges/private API seam, CI/release workflows, coverage topology, and security hardening prerequisites.
- Remaining: Complete behavioral specs and execute WS-01 through WS-04.
- Blockers: Platform/coverage/smoke targets must reflect the final code from specs `030`–`035`.
- Next action: After behavior stabilizes, capture baseline CI/coverage/host-smoke evidence and make this spec Active.

## Completion summary

Pending.
