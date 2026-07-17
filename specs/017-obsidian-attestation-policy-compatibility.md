---
id: "017"
title: "Obsidian attestation policy compatibility"
status: Active
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex"
---

# 017 — Obsidian attestation policy compatibility

## Context

Release 0.11.3 has three single-subject GitHub attestations that pass strict `gh attestation verify` checks against the repository, tag ref, signer workflow, and source commit. Obsidian's automated release review still rejects the `main.js` and `styles.css` attestations, so its policy is stricter or materially different from the GitHub CLI policy. Pivi's release workflow is dispatched at a tag, while the official sample and established plugins use a workflow triggered directly by a tag push.

## Goal and success criteria

Make Pivi's release provenance conform to the attestation identity expected by Obsidian's automated review.

- [x] The exact policy difference is supported by certificate/workflow evidence from Pivi and accepted Obsidian plugins.
- [x] The release workflow follows the official tag-push publishing shape without duplicate release runs.
- [ ] A new patch release contains only the required assets and no longer produces the reported Obsidian attestation errors.

## Scope and non-goals

In scope:

- GitHub release triggers, provenance identity, artifact upload, and automated review compatibility.

Not in scope:

- Product behavior changes.
- Altering or deleting historical releases or attestations.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Do not publish another patch until the Obsidian policy difference is evidenced. | GitHub CLI verification alone did not predict automated review behavior. | WS-01, WS-02 |
| 2026-07-17 | Superseded: make `push.tags` the only publishing trigger and use one multi-subject release attestation. | The tag-push part remains; 0.11.4 disproved the multi-subject attestation assumption in the live reviewer. | WS-01, WS-02, WS-04 |
| 2026-07-17 | Keep Release Please for version/changelog PRs but set `skip-github-release: true`. | A tag created by the default `GITHUB_TOKEN` does not trigger another workflow; a maintainer-pushed tag preserves the required tag-push provenance identity. | WS-02, WS-04 |
| 2026-07-17 | Fail publication when the matching changelog section is absent or empty. | Release notes must remain complete and auditable instead of falling back to generic text. | WS-02, WS-04 |
| 2026-07-17 | Stop generating artifact attestations and verify published bytes directly. | 0.11.4 proves tag-push and multi-subject shape are not sufficient: its GitHub-valid bundle still fails the live directory review. Pivi's last completed scan predates attestations, and multiple plugins newly accepted on July 13–17 publish unattested assets. | WS-01, WS-02, WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Compare official/sample/accepted workflows and certificate identities | Codex | Done | None | SHA-pinned workflow and attestation evidence |
| WS-02 | Implement and test the compatible release path | Codex | Done | WS-01 | Static workflow tests and full quality gate |
| WS-03 | Independent review of the policy hypothesis | Verification subagent | Done | None | Evidence-oriented written review |
| WS-04 | Publish and validate the next patch | Codex | In progress | WS-02 | GitHub run plus Obsidian review result |

## Verification

- Compare decoded certificate and SLSA predicate fields across Pivi, Claudian, the official sample, and recent accepted plugins.
- Run repository workflow regression tests and the complete local quality gate.
- Verify the published release assets and repeat the Obsidian automated review that produced the original error.
- Run `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/10-roadmap-release-and-maintenance.md`.
- Nearest local guidance: None unless build behavior changes.
- Parent/package guidance: None.
- Root guidance and roadmap: `AGENTS.md`.

## Progress and handoff

### 2026-07-17 — Codex — WS-01

- Changed: Created the tracked compatibility investigation.
- Evidence: Pivi 0.11.3's certificate records `githubWorkflowTrigger=workflow_dispatch`. Claudian 2.0.34 and recent releases from Meta Bind, CSS Editor, Open Tab Settings, Read Only View, and Raindrop.io all record `githubWorkflowTrigger=push` and `sourceRepositoryRef=refs/tags/<version>`. All five repositories are present in `obsidianmd/obsidian-releases/community-plugins.json`. The official sample workflow at `23c165fd362d4049330cb3edad6a52914ff2007a` also publishes only from tag pushes.
- Remaining: Run regression/quality gates, publish the next patch, and repeat the Obsidian review.
- Blockers: The automated review implementation is not public, so final compatibility still requires the external review result.
- Next action: Validate the tag-push workflow and prepare a complete patch changelog.

### 2026-07-17 — Verification subagent — WS-03

- Changed: Independently decoded the 0.11.3 and Claudian attestation bundles and compared their workflows with the official sample.
- Evidence: 0.11.3 has a tag ref but a `workflow_dispatch` certificate and separate single-subject statements; Claudian has a `push` certificate and a multi-subject statement. The official sample uses tag push and a multi-subject statement for `main.js` and optional `styles.css`.
- Remaining: None for hypothesis review.
- Blockers: None.
- Next action: Mirror the evidenced tag-push release shape.

### 2026-07-17 — Codex — WS-02

- Changed: Made `push.tags` the only publishing trigger, changed the release statement to the established multi-subject shape, separated Release Please PR generation from publication, and made versioned changelog notes mandatory.
- Evidence: Focused release workflow tests, 256 suites / 1,957 tests with coverage, typecheck, zero-warning lint, architecture/package/i18n/spec checks, production build, and the bundle-size gate passed. Both workflow files parse as YAML; 0.11.4 package, lockfile, manifest, release manifest, and Obsidian versions metadata agree. The deployed build reloaded with no captured Obsidian errors.
- Remaining: Commit/push the 0.11.4 release metadata, push its annotated tag, inspect the public certificate, and repeat the Obsidian automated review.
- Blockers: Final automated-review confirmation is external to the repository.
- Next action: Publish 0.11.4 from its annotated tag.

### 2026-07-17 — Codex — WS-04

- Changed: Published 0.11.4 from an annotated tag through the new tag-push workflow and queued a fresh Community review.
- Evidence: GitHub Actions run `29555795196` records `event=push` and succeeded. Both checked assets resolve to exactly one multi-subject attestation with `sourceRepositoryRef=refs/tags/0.11.4`, source digest `ff2d1818a86a1c3b099495882b9aac6b546be6bc`, and the expected signer workflow; strict GitHub CLI verification passes. The Community review nevertheless reports the same cryptographic errors for both assets. Newly mirrored Interactive Map, Star Tags, Cursor-Smith, and FB2 Reader releases have no artifact attestations and passed automated review into the directory.
- Remaining: Publish an unattested, version-distinct patch from the tag-push workflow and repeat the Community review.
- Blockers: The review service's low-level signature-verifier implementation is not public.
- Next action: Remove attestation generation, retain byte-for-byte publication checks, and release the next patch.

## Completion summary

Pending.
