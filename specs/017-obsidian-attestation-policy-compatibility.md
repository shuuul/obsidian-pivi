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

- [ ] The exact policy difference is supported by certificate/workflow evidence from Pivi and accepted Obsidian plugins.
- [ ] The release workflow follows the official tag-push publishing shape without duplicate release runs.
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
| 2026-07-17 | Make `push.tags` the only publishing trigger and use one multi-subject release attestation. | The official sample, Claudian, and five recently released community-listed plugins all produce `push` certificates at tag refs; Pivi 0.11.3 records `workflow_dispatch`. The official sample and accepted releases also establish multi-subject statements as the compatible shape. | WS-01, WS-02, WS-04 |
| 2026-07-17 | Keep Release Please for version/changelog PRs but set `skip-github-release: true`. | A tag created by the default `GITHUB_TOKEN` does not trigger another workflow; a maintainer-pushed tag preserves the required tag-push provenance identity. | WS-02, WS-04 |
| 2026-07-17 | Fail publication when the matching changelog section is absent or empty. | Release notes must remain complete and auditable instead of falling back to generic text. | WS-02, WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Compare official/sample/accepted workflows and certificate identities | Codex | Done | None | SHA-pinned workflow and attestation evidence |
| WS-02 | Implement and test the compatible release path | Codex | In progress | WS-01 | Static workflow tests and full quality gate |
| WS-03 | Independent review of the policy hypothesis | Verification subagent | Done | None | Evidence-oriented written review |
| WS-04 | Publish and validate the next patch | Codex | Pending | WS-02 | GitHub run plus Obsidian review result |

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

## Completion summary

Pending.
