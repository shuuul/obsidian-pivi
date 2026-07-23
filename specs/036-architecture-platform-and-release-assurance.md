---
id: "036"
title: "Architecture platform and release assurance"
status: Draft
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 036 — Architecture platform and release assurance

## Context

The core package exposes many wildcard and implementation subpaths, including Pi engine/session/shim files. `SessionTreeStore` intentionally contains Pi private API usage, but the three Pi packages use caret ranges in both the root and package manifests. The lockfile makes the current install reproducible while present, yet a dependency update can change private members without a narrow compatibility gate.

CI runs complete gates only on Ubuntu. Platform-sensitive path, process, stdio, Skills, and shell behavior lacks macOS/Windows jobs. The release workflow rebuilds and verifies artifacts but does not directly depend on the same quality-gate job, and third-party Actions use mutable major tags rather than commit SHAs.

Global coverage thresholds are appropriate for the UI-heavy repository but do not guarantee strong branch coverage in credential, OAuth, network, process, path, Skills, or authorization modules. The existing smoke suite is not a real Obsidian/Electron lifecycle test. Security/privacy documentation exists in README/docs, but there is no root disclosure/threat-model document.

This seventh spec follows behavioral hardening specs `030`–`035`, then makes their boundaries and evidence durable.

## Goal and success criteria

Constrain unstable implementation dependencies and make cross-platform, security, host-lifecycle, and release evidence mandatory.

- [ ] All Pi packages use one exact synchronized version in every manifest/override and lockfile.
- [ ] Private Pi API access exists only behind one explicit adapter/capability assertion with an actionable incompatibility error.
- [ ] A candidate Pi upgrade lane runs compatibility tests before the exact version is changed.
- [ ] Cross-package imports use documented domain facades; wildcard exports and implementation subpaths are removed unless a verified consumer requires a stable contract.
- [ ] Architecture checks reject new imports of Pi internals, private adapters, engine implementation files, and non-facade cross-package paths.
- [ ] Ubuntu retains full gates; macOS and Windows run focused path/process/MCP stdio/Skills suites with explicit supported behavior.
- [ ] Security-critical directories enforce dedicated high branch thresholds based on direct tests, independent of global coverage.
- [ ] A real Obsidian/Electron smoke loads Pivi, opens the view, creates/restores a session, mutates a disposable note, starts/stops a fake stdio server, unloads/reloads, and detects leaked process/global state.
- [ ] CI and release share/reuse one quality-gates workflow or release proves the tag commit already passed the exact required gates.
- [ ] Third-party Actions in privileged workflows are pinned to reviewed commit SHAs and remain Dependabot-updatable.
- [ ] Root `SECURITY.md` documents supported versions, disclosure, trust boundaries, capability/credential matrix, network data flows, prompt-injection stance, and third-party extension responsibility.
- [ ] Automated documentation contracts check version, React major, minimum Obsidian, SecretStorage claims, default capability state, stdio startup semantics, and release invariants.

## Scope and non-goals

In scope:

- Exact Pi dependency policy, private adapter/capability check, and candidate-upgrade testing.
- Core package export/facade reduction and architecture enforcement.
- Focused macOS/Windows CI, security coverage thresholds, and real host smoke.
- Reusable release quality gates and immutable Action references.
- `SECURITY.md`, threat/capability/credential/network documentation, and contract checks.

Not in scope:

- Changing Pi runtime behavior solely to avoid a private API when upstream exposes no equivalent.
- Claiming full Linux/Windows product support beyond the scenarios tested and documented.
- Replacing GitHub Actions or Release Please.
- Reopening completed release-attestation decisions from specs `016` and `017` without new reviewer evidence.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Pin Pi dependencies exactly and upgrade them as one tested unit. | Private API compatibility and synchronized Pi package identity outweigh semver convenience. | WS-01 |
| 2026-07-23 | Permit private Pi access only in one named adapter with startup assertions. | An explicit isolation seam makes breakage detectable and prevents accidental spread. | WS-01 |
| 2026-07-23 | Narrow exports from verified consumer imports rather than designing speculative facades. | Forward development should remove accidental API surface without adding wrapper layers. | WS-02 |
| 2026-07-23 | Keep Ubuntu full CI and add focused macOS/Windows jobs. | This controls cost while directly covering the platform-sensitive code. | WS-03 |
| 2026-07-23 | Make release depend on the same quality-gate definition used by CI. | Rebuilding artifacts alone does not prove tests, lint, types, architecture, or security coverage for the tag. | WS-04 |
| 2026-07-23 | Treat security documentation claims as testable contracts where repository metadata can prove them. | Version/storage/default-state drift has repeatedly made prose misleading. | WS-05 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Exact Pi pins, private adapter/capability assertion, and candidate-upgrade lane | Unassigned | Pending | Specs 030–035 completed | Compatibility tests and forced-missing-capability failure |
| WS-02 | Consumer-driven core export reduction and stronger architecture rules | Unassigned | Pending | WS-01 | Export/import scan, package tests, boundaries |
| WS-03 | Focused macOS/Windows jobs, security coverage thresholds, and deterministic fixtures | Unassigned | Pending | Specs 030–035 completed | CI matrix evidence |
| WS-04 | Real Obsidian/Electron smoke plus reusable CI/release gates and SHA-pinned Actions | Unassigned | Pending | WS-03 | Smoke artifacts and workflow validation |
| WS-05 | `SECURITY.md`, docs-contract checker, durable guidance, and closeout | Unassigned | Pending | WS-01–WS-04 | Docs checks, full gates, release dry validation |

## Verification

Required evidence:

- Root and workspace manifests plus lockfile contain one exact Pi version; a repository check fails on caret/tilde/mismatch.
- A fake Pi manager lacking each private capability fails with the documented compatibility error before session mutation.
- Every remaining package export has a current consumer or documented stable role; removed paths are caught by typecheck/architecture tests.
- Platform jobs exercise Windows drive/UNC/case rules, macOS/Linux process groups, Windows process-tree termination, stdio executable discovery, and Skills staging.
- Security modules from specs `030`–`035` meet their dedicated branch thresholds without exclusion comments.
- Host smoke records plugin load/unload, restored session, disposable note mutation/recovery, fake stdio shutdown, original `window.fetch` identity, and zero captured runtime errors.
- A release workflow invocation cannot publish when any shared quality gate fails.
- Action references resolve to full commit SHAs and Dependabot configuration covers updates.
- Docs-contract fixtures intentionally drift each checked fact and produce a focused failure.

Commands:

```bash
npm ci
npm run typecheck
npm run lint
npm run check:boundaries
npm run test:coverage
npm run build
npm run check:bundle-size
npm run analyze:bundle
npm run check:specs
```

Workflow and real-host verification commands introduced by this spec must be documented in `package.json`, `AGENTS.md`, and `docs/09-development-debugging-and-validation.md`.

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, `docs/09-development-debugging-and-validation.md`, and `docs/10-roadmap-release-and-maintenance.md`.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, `tests/AGENTS.md`, `scripts/AGENTS.md`, and affected package guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` and every package whose public import contract changes.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, new `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Consolidated Pi private/export risk, platform CI, security coverage, real-host smoke, release gates, and security documentation into the assurance phase.
- Evidence: Current package exports/dependency ranges, `SessionTreeStore`, workflow files, coverage scripts, docs, and archived release specs.
- Remaining: Complete behavior specs, verify consumer imports, and execute WS-01 through WS-05.
- Blockers: Security coverage and host smoke targets must reflect the final modules created by specs `030`–`035`.
- Next action: After behavioral hardening stabilizes, make this spec Active and capture baseline platform/coverage/smoke evidence.

## Completion summary

Pending.
