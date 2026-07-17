---
id: "016"
title: "Release attestation hardening"
status: Active
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex"
---

# 016 — Release attestation hardening

## Context

Release 0.11.2 produced tag-bound GitHub artifact attestations, but downstream release review still rejected `main.js` and `styles.css`. The two rejected assets reused the exact 0.11.1 digests and therefore resolve to multiple historical attestations, while the versioned `manifest.json` digest resolves only to the 0.11.2 attestation. The current workflow also places all three files in one multi-subject DSSE statement, which is incompatible with verifiers affected by sigstore-rs issue #596.

## Goal and success criteria

Publish 0.11.3 with unambiguous, independently verifiable provenance for every Obsidian release asset.

- [ ] Each release asset has a version-specific digest and a single-subject attestation from `refs/tags/0.11.3`.
- [ ] The workflow downloads the published assets and verifies all three against repository provenance before succeeding.
- [ ] Release 0.11.3 contains only `main.js`, `manifest.json`, and `styles.css`, with versions aligned to the tag.

## Scope and non-goals

In scope:

- Release build metadata, attestation generation, verification, and 0.11.3 publication.

Not in scope:

- Product behavior changes.
- Rewriting or deleting historical attestations.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Generate one attestation per release asset. | Avoids multi-subject verification failures in downstream sigstore-rs consumers. | WS-01 |
| 2026-07-17 | Embed the package version in generated JavaScript and CSS artifacts. | Prevents unchanged assets from sharing historical attestation lookup sets across release tags. | WS-01 |
| 2026-07-17 | Verify freshly downloaded release assets before the publishing job succeeds. | Tests the actual uploaded bytes and repository provenance rather than only local build outputs. | WS-02 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Harden build and attestation workflow | Codex | Done | None | Build checks plus workflow inspection |
| WS-02 | Validate and publish 0.11.3 | Codex | In progress | WS-01 | GitHub Actions run, asset digests, `gh attestation verify` |
| WS-03 | Independent evidence review | Verification subagent | Done | None | Written root-cause and risk review |

## Verification

- `npm run check:specs`
- Focused tests for build output version markers and release workflow invariants.
- `npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- Download all 0.11.3 assets and run `gh attestation verify` with repository and tag/source-digest constraints.

## Documentation sync

- Numbered developer docs: `docs/10-roadmap-release-and-maintenance.md`.
- Nearest local guidance: `scripts/AGENTS.md` if build output behavior changes.
- Parent/package guidance: None; no package boundary changes.
- Root guidance and roadmap: `AGENTS.md`.

## Progress and handoff

### 2026-07-17 — Codex — WS-01

- Changed: Added version-specific JavaScript/CSS banners, single-subject attestations, required artifact metadata permission, uploaded-asset verification, regression tests, and durable release guidance.
- Evidence: 0.11.1 and 0.11.2 reuse identical `main.js` and `styles.css` digests; those digests resolve to multiple attestations, while the unique 0.11.2 manifest digest resolves to one. The full local quality gate passes with 256 suites / 1,955 tests, and the built 0.11.2 artifacts start with the version banner and remain below the 5 MB limit.
- Remaining: Publish 0.11.3 and record remote evidence.
- Blockers: None.
- Next action: Commit the fix and prepare the manual patch release.

### 2026-07-17 — Verification subagent — WS-03

- Changed: No files; independently reviewed GitHub releases, Claudian, `actions/attest`, and sigstore-rs issue #596.
- Evidence: Confirmed the reused Pivi digests, Claudian's additional `artifact-metadata: write` permission, and the downstream failure mode for non-first subjects in a multi-subject DSSE statement.
- Remaining: None.
- Blockers: None.
- Next action: Coordinator proceeds with the per-asset attestation design.

### 2026-07-17 — Codex — WS-02

- Changed: Prepared version 0.11.3 metadata and changelog.
- Evidence: Package, manifest, and Release Please versions align at 0.11.3; focused release/build tests pass; production artifacts carry the 0.11.3 banner, remain below the bundle limit, deploy to the configured vault, and reload successfully.
- Remaining: Push the fix and release commit, create the 0.11.3 tag, run the publishing workflow, and verify remote assets.
- Blockers: None.
- Next action: Commit and push the release preparation.

## Completion summary

Pending.
