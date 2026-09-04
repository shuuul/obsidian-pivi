---
id: "049"
title: "Post-review contracts architecture and community execution"
status: Active
created: 2026-09-04
updated: 2026-09-04
coordinator: "Amp"
---

# 049 — Post-review contracts architecture and community execution

## Context

The September 2026 repository review concluded that Pivi's five-package dependency direction, architecture checks, security controls, and release pipeline should be preserved. The next work is evolutionary: repair documentation drift first, then reduce composition-layer coupling, narrow package API surfaces, give compatibility code an explicit retirement path, improve bundle/test change signals, and make contribution and support paths visible.

Repository inspection confirmed the first blocking defect after the `0.25.0` Stdio MCP removal in `f3c503f0`: the README security table still describes Stdio process startup; lifecycle and validation docs still describe a fake stdio listener; and `scripts/smoke-obsidian.mjs` starts an independent process that is never connected to Pivi. README, SECURITY, and the MCP developer handbook otherwise state that only remote HTTP/SSE MCP is supported. GitHub issue [#100](https://github.com/shuuul/obsidian-pivi/issues/100) tracks this P0 contract repair.

The broader review's repository popularity and download figures were externally observed point-in-time inputs, not acceptance evidence for this spec. Any later growth baseline must be refreshed before a workstream sets numerical targets. Likewise, later architecture targets are hypotheses to validate against the then-current tree after the P0 merge, not permission to begin a rewrite now.

## Goal and success criteria

Preserve Pivi's existing package architecture while making active documentation mechanically truthful, reducing composition and public-API friction in bounded slices, and establishing visible contribution, support, compatibility, and maintenance loops.

- [x] P0 issue #100 is merged with one machine-readable v0.25.0 capability contract, aligned active docs, a focused regression suite, and the docs check in shared quality gates.
- [x] No post-P0 workstream starts until GitHub reports the issue #100 pull request as merged; the merge URL and commit are recorded in Progress and handoff.
- [x] Repository rules protect `main` and SemVer release tags without requiring a second reviewer while Pivi remains single-maintainer.
- [x] `PiviPlugin` becomes a lifecycle-focused composition root, feature consumers receive narrow facades, and existing behavior/configuration remain compatible under lifecycle and feature tests.
- [x] Cross-package imports are restricted to curated exports and architecture checks reject undeclared or internal package paths without adding another workspace.
- [x] Large UI/runtime factories and coordinators are split by user-facing feature only where a measured ownership seam exists; no generic DI container is introduced.
- [x] Every Pivi-owned Pi compatibility shim records its upstream version, reason, verification test, removal condition, and tracking issue, with one non-duplicating canary route.
- [ ] Pull requests report explainable bundle change data and focused test suites fail on unexpected warning/error noise without replacing correctness assertions with global coverage targets.
- [x] Public contribution, discussion, recipe, and platform-support paths exist; optional update templates are available without creating an unsupported publication or funding commitment.

## Scope and non-goals

In scope:

- P0 active-document contract repair and obsolete fake Stdio smoke removal.
- GitHub branch/tag protection and community entry points after the P0 merge gate.
- Bounded composition-root, feature-facade, export-surface, and vertical-factory improvements after re-inspection.
- Pi compatibility lifecycle, bundle-delta reporting, and test-signal improvements.
- Starter recipes, desktop support tiers, and optional transparent maintenance/support reporting templates.

Not in scope:

- Whole-repository rewrite, a new workspace, or a general dependency-injection container.
- Mobile support as a P0 or reopening archived mobile spec 042 without a new feasibility decision.
- TypeScript project references without measured incremental-build or independent-package need.
- Blind code splitting, bundle reduction without metafile evidence, or a global coverage-percentage campaign.
- Paid feature prioritization or a mandatory second reviewer before another active maintainer exists.
- Rewriting historical changelog entries or archived specs to remove accurate Stdio history.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-09-04 | Use one umbrella spec, make WS-01 decision-complete now, and keep every later workstream blocked until issue #100's PR merges. | Preserves the review's dependency order without designing or starting a broad refactor against drifting code. | All |
| 2026-09-04 | Stop this execution turn after opening the verified P0 PR; do not merge it or create the other four public issues. | A PR is reviewable and reversible; merging changes shared state and remains a maintainer decision. | WS-01 |
| 2026-09-04 | Store the canonical contract in `docs/capabilities.json` with `streamable-http` and `sse`; record `stdio-mcp`, `mcp-json-import`, and `vim-mappings` as removed in `0.25.0`. | Protocol-precise machine names avoid treating generic process `stdio` as MCP support and cover the capabilities removed together. | WS-01 |
| 2026-09-04 | Validate canonical MCP claims and reject precise current-feature phrases in active Markdown while allowing negative, migration, changelog, and archived-spec references. | A bare `stdio` ban would flag legitimate Node/process and compatibility documentation; no scan would permit the same drift to recur elsewhere. | WS-01 |
| 2026-09-04 | Remove the fake stdio process from the real-host smoke. | Inspection proved it is not connected to Pivi and therefore no longer validates a current plugin lifecycle contract. | WS-01 |
| 2026-09-04 | Integrate `check:docs-contracts` through `check:boundaries`, not a duplicate workflow step. | Shared quality gates already run `check:boundaries` in PR and release workflows. | WS-01 |
| 2026-09-04 | Delete the stale standalone marketing draft from Git and the working tree in the P0 change. | The maintainer explicitly retired it; no tracked document referenced it, and future community work is represented by gated WS-08/WS-09 instead. | WS-01 |
| 2026-09-04 | Treat later workstream acceptance details as provisional until each is re-inspected and linked to its own issue after the P0 merge. | The report is static review input; implementation facts can change while WS-01 is under review. | WS-02–WS-09 |
| 2026-09-04 | Continue post-P0 work after the maintainer approved the merge, using protected-branch pull requests for repository changes. | Supersedes the earlier stop-after-PR execution limit without weakening the now-active repository rules. | WS-02–WS-09 |
| 2026-09-04 | Do not add a Sponsor link or `.github/FUNDING.yml`, and do not make a recurring publication cadence a completion requirement. | The maintainer is not applying for GitHub Sponsors now and prefers optional update templates over a schedule that may not be sustained. Funding can return as independent work after a valid destination exists. | WS-08–WS-09 |
| 2026-09-04 | Make `PiviPlugin` a lifecycle-only shell and move product ownership to `PiviApplication`; pass the real Plugin separately where Obsidian requires it. | Removes the service locator from the framework subclass without changing lifecycle ordering or adding a container/workspace. | WS-03 |
| 2026-09-04 | Curate the existing package contract without rewriting imports: replace `@pivi/agent` wildcard exports with the namespace and focused leaves already consumed, remove every workspace wildcard TypeScript path, and make both patterns fail architecture checks. | Existing checks already reject undeclared imports and cross-package relative paths. Explicitly listing current leaves closes accidental future exposure while preserving presentation-safe and compatibility-test entrypoints without introducing barrel side effects. | WS-04 |
| 2026-09-04 | Treat only upstream-shape-dependent replacements and overrides as Pi compatibility entries; keep ordinary engine adapters, retry policy, and product OAuth behavior out of the manifest. | A lifecycle manifest is useful only when each entry can be removed after a concrete upstream contract changes; cataloging all Pi-facing code would create permanent noise. | WS-06 |
| 2026-09-04 | Keep the next-version canary informational, mutate only its ephemeral checkout, and update one marker-backed comment on issue #113. | Dependency upgrades still require review; one stable issue comment provides a current signal without duplicate alert issues or required-check noise. | WS-06 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done`.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | Issue #100: remote-only MCP capability manifest, aligned active docs, obsolete smoke cleanup, contract checker, and PR | Amp | Done | None | Focused Jest; `check:docs-contracts`; `check:boundaries`; typecheck; lint; diff check; PR CI |
| WS-02 | Issue #102: protect `main` and SemVer tags with required quality/platform checks and conversation resolution | Amp | Done | WS-01 done; maintainer authorized continued execution | Query effective GitHub rules; verify force-push/delete restrictions and required checks without a reviewer requirement |
| WS-03 | Issue #103: reduce `PiviPlugin` to lifecycle composition and introduce responsibility-scoped application/feature facades | Amp | Done | Fresh ownership/call-graph inspection complete | Lifecycle tests, feature contract tests, architecture check, full quality gates |
| WS-04 | Issue #104: curate package exports and reject undeclared/internal cross-package imports | Amp | Done | WS-03 application/facade boundary settled | Export contract fixtures, architecture check, typecheck, build |
| WS-05 | Issue #111: split oversized UI/runtime factories and coordinators only at measured feature ownership seams | Amp | Done | WS-03 application boundary settled; dedicated issue required | Feature suites plus file-size and changed-slice evidence recorded in spec/issue |
| WS-06 | Issue #113: add Pi compatibility manifest and one issue-updating next-version canary | Amp | Done | Current shim inventory and tracking-issue decision complete | Manifest completeness check, `test:pi-compat`, scheduled canary dry run |
| WS-07 | Add PR bundle delta/top-input reporting and improve warning/error test signal | Unassigned | Pending | Refreshed bundle baseline and CI-summary design | Metafile comparison fixture, CI summary fixture, focused noisy-console tests, bundle gate |
| WS-08 | Issue #105: enable Discussions and add contributor, conduct, support, and issue-template entry points | Amp | Done | Maintainer authorized continued execution | Default-branch community profile, issue-form files/contact routes, and effective Discussions categories verified |
| WS-09 | Publish three starter recipes, desktop support matrix, showcase route, and optional update/report templates | Amp | Done | WS-08 merged | Default-branch recipe index, platform matrix, README routes, templates, and newcomer issues verified |

## Verification

WS-01 local acceptance:

```bash
npm run test -- tests/unit/scripts/checkDocsContracts.test.ts
npm run check:docs-contracts
npm run check:boundaries
npm run typecheck
npm run lint
git diff --check
```

The focused fixture suite must prove: the repository passes; each removed current-feature example fails; negative Stdio support and rejected-config statements pass; archived specs and CHANGELOG are not treated as active claims; and canonical transport drift in README, SECURITY, or the MCP architecture page fails.

Before WS-01 is marked Done, record the issue, PR, CI result, and merged state separately. An open or green PR does not satisfy the merge gate. Before each later workstream moves from Blocked, refresh its current-state evidence, make its decisions and acceptance commands concrete, create/link the corresponding public issue, and update this spec first.

Before final closeout, run all repository quality gates appropriate to every accumulated change, sync lasting contracts into owning docs/guidance, run `spec_check`, and archive only after all criteria are either satisfied or explicitly removed by a recorded decision.

## Documentation sync

- Durable product/developer docs: WS-01 updates `README.md`, `SECURITY.md`, `docs/03-plugin-lifecycle-and-composition.md`, `docs/07-tools-skills-mcp-and-integrations.md`, `docs/09-development-debugging-and-validation.md`, and the command/maintenance references that own the new check. WS-04 updates `docs/02-architecture-and-technology.md` and `packages/agent/README.md` for the explicit package-resolution contract. WS-05 updates `docs/08-presentation-and-settings.md` for the separate chat/settings port-adapter ownership. WS-06 updates `docs/09-development-debugging-and-validation.md` and `docs/10-roadmap-release-and-maintenance.md` for the manifest/canary route. Later workstreams must name their own durable targets before starting.
- Nearest local `AGENTS.md`: update `scripts/AGENTS.md` for repository checks and canary preparation; update `packages/agent/AGENTS.md` for its explicit public surface; update `src/app/AGENTS.md` for the WS-05 adapter split; update `packages/engine-pi/AGENTS.md` for the compatibility lifecycle. Update later feature/package guidance only with the workstream that changes it.
- Parent/package guidance: none for WS-01; no package implementation contract changes.
- Root guidance and roadmap: update root `AGENTS.md` only if its gate list is stale; update `docs/10-roadmap-release-and-maintenance.md` with the durable sequence and refreshed priorities, not transient progress.

### Experiment refs

Optional. List final experiment Git refs here before archiving.

## Progress and handoff

Append entries rather than rewriting another worker's record.

### 2026-09-04 — Amp — WS-01

- Changed: Created issue #100; verified the contradictory README sentence, two stale smoke descriptions, and the disconnected fake stdio process; completed the decision tree for WS-01; reserved and activated spec 049.
- Evidence: `package.json` is `0.25.0`; `f3c503f0` removed Stdio MCP; current MCP types/connection code expose Streamable HTTP and legacy SSE only; issue #100 records the bounded implementation contract.
- Remaining: Implement manifest/check/tests/docs/smoke cleanup, run local gates, commit, push, and open the P0 PR.
- Blockers: WS-02–WS-09 are blocked until the WS-01 PR is merged. WS-01 has no implementation blocker.
- Next action: Implement the focused docs-contract regression test and checker before editing the stale claims.

### 2026-09-04 — Amp — WS-01 implementation

- Changed: Added `docs/capabilities.json` and `check:docs-contracts`, aligned the three canonical MCP statements and active lifecycle/validation docs, removed the disconnected fake stdio process from the host smoke, and synchronized operational guidance.
- Evidence: Focused docs/spec suites passed (24 tests); full Jest passed (349 suites / 3,132 tests); `check:docs-contracts`, `check:boundaries`, typecheck, lint, `git diff --check`, and the real `smoke:obsidian` route passed on macOS with the configured development vault.
- Remaining: Commit, push, open the PR linked to issue #100, record its URL, and wait for CI/maintainer merge.
- Blockers: WS-02–WS-09 remain blocked. WS-01 will become blocked on maintainer merge after its PR is open.
- Next action: Review the final diff, commit the verified implementation, and open the P0 PR.

### 2026-09-04 — Maintainer-requested stale draft removal — WS-01

- Changed: Deleted the retired standalone marketing draft from the repository and local working tree.
- Evidence: Repository-wide reference search found no references outside the file itself before deletion.
- Remaining: Include the deletion in the P0 commit and PR.
- Blockers: None beyond the existing P0 review/merge gate.
- Next action: Re-run docs/spec checks after deletion and stage the final diff.

### 2026-09-04 — Amp — WS-01 pull request handoff

- Changed: Committed the verified P0 implementation as `258f08d0`, pushed `docs/remote-only-mcp-contract`, and opened [PR #101](https://github.com/shuuul/obsidian-pivi/pull/101) with `Fixes #100`.
- Evidence: The remote PR targets `main` and explicitly repeats the merge gate for WS-02–WS-09.
- Remaining: Wait for required PR checks and maintainer merge; after merge, record the merge URL/commit before unblocking any later workstream.
- Blockers: WS-01 and every later workstream are blocked on PR #101 merging.
- Next action: Maintainer reviews PR #101; no broader refactor starts before merge.

### 2026-09-04 — Amp — P0 merge gate satisfied

- Changed: Maintainer authorized merge after all checks passed; [PR #101](https://github.com/shuuul/obsidian-pivi/pull/101) was squash-merged into `main`, automatically closing issue #100 and deleting the remote branch.
- Evidence: GitHub reports merge commit [`6545cc4e`](https://github.com/shuuul/obsidian-pivi/commit/6545cc4ee09f399245ee93cad74f9f91463fe0a8); `quality-gates`, macOS platform security, and Windows platform security all completed successfully.
- Remaining: Execute the now-unblocked workstreams in dependency order.
- Blockers: WS-04/WS-05 retain their WS-03 dependency; other workstreams require their own decision-complete implementation slices.
- Next action: Apply and verify the repository rules in issue #102, then begin the fresh WS-03 call-graph inspection.

### 2026-09-04 — Amp — Public issue backlog

- Changed: Created [#102](https://github.com/shuuul/obsidian-pivi/issues/102) for repository rules, [#103](https://github.com/shuuul/obsidian-pivi/issues/103) for the lifecycle-only composition root, [#104](https://github.com/shuuul/obsidian-pivi/issues/104) for curated package exports, and [#105](https://github.com/shuuul/obsidian-pivi/issues/105) for community entry points and recipes.
- Evidence: GitHub reports all four issues open with the report's requested titles and bounded acceptance criteria.
- Remaining: Implement and verify each workstream; create narrower follow-up issues only when WS-06/WS-07 inventory proves they cannot remain contained workstreams.
- Blockers: As listed in the workstream table.
- Next action: Complete WS-02 against effective GitHub repository rules.

### 2026-09-04 — Amp — Repository protection and community entry points

- Changed: Enabled Discussions; applied branch ruleset [22270940](https://github.com/shuuul/obsidian-pivi/rules/22270940) and tag ruleset [22270941](https://github.com/shuuul/obsidian-pivi/rules/22270941); closed issue #102 with effective-rule evidence; drafted contribution, conduct, support, issue-form, platform-support, reporting-template, and three starter-recipe files; created newcomer-sized recipe issues [#106](https://github.com/shuuul/obsidian-pivi/issues/106) and [#107](https://github.com/shuuul/obsidian-pivi/issues/107) with the `good first issue` label.
- Evidence: Effective `main` rules require strict quality/macOS/Windows checks and conversation resolution, require a pull request with zero approvals, and block deletion/non-fast-forward updates; SemVer tags block updates and deletion. GitHub exposes Announcements, Q&A, Show and tell, and Ideas Discussion categories.
- Remaining: None. PR #108 is merged and the effective default-branch surfaces are verified.
- Blockers: None. Funding and a recurring Discussion cadence were explicitly removed from this spec's completion criteria; the templates remain optional.
- Next action: Keep the verified community surfaces stable while the architecture stack proceeds.

### 2026-09-04 — Amp — WS-03 application shell refactor

- Changed: Reduced `src/main.ts` to a lifecycle-only Obsidian shell holding only `PiviApplicationLifecycle`; `PiviApplication` now owns concrete Chat, Sessions, Workspace, Integrations, and Settings facade values. Registrations receive the real Plugin plus only their scoped facades; chat UI composition receives chat and session facades separately; service-graph construction receives a narrow runtime composition host; and open-tab persistence receives only the Obsidian app.
- Evidence: Focused application/main lifecycle suites passed (4 suites / 19 tests); focused `src`/`tests` lint, `check:architecture`, `check:specs`, and `git diff --check` passed.
- Remaining: Run authoritative source/test typecheck and full lint in a worktree-local dependency install; the secondary worktree has no `node_modules`, while borrowing the parent install produces duplicate-worktree package identities and is missing the pinned Pi OAuth declaration leaves.
- Blockers: WS-03 remains In progress and must not be marked Done until the requested authoritative verification passes.
- Next action: Install dependencies in this worktree, run all requested gates, and address any genuine (non-environment) failures.

### 2026-09-04 — Amp — WS-03 verification complete

- Changed: Replaced the first-pass broad application handoff with explicit `ChatFacade`, `SessionsFacade`, `WorkspaceFacade`, `IntegrationsFacade`, and `SettingsFacade` objects. Registrations receive the real Obsidian Plugin plus only their required facades; chat-port construction receives chat and session behavior separately; `PiviPluginHost` was removed.
- Evidence: `src/main.ts` is 26 lines; production `src/app` has no `@/main` import; focused facade/lifecycle/registration suites passed (10 suites / 78 tests); full coverage passed (350 suites / 3,133 tests); dependency audit, source/test typecheck, lint, all boundary checks, production build, bundle-size check, and `git diff --check` passed. Built `main.js` is 4,169,451 bytes against the 5 MiB ceiling.
- Remaining: Open the architecture pull request after reconciling its stacked community-docs base; continue WS-04 and WS-05 only as separate bounded changes.
- Blockers: The architecture branch currently includes PR #108 as its base commit. It must be rebased onto protected `main` after #108 is merged or otherwise restacked before review.
- Next action: Commit the verified WS-03 change, then inspect issue #104's current package-export evidence without widening this pull request.

### 2026-09-04 — Amp — WS-04 package export inventory

- Changed: Inventoried package manifests and all source/test import specifiers. Replaced `@pivi/agent` wildcard exports with explicit currently consumed namespace and focused-leaf entries, removed workspace-package wildcard aliases from root TypeScript paths, and added architecture failures for either wildcard pattern.
- Evidence: Existing architecture fixtures already reject undeclared package paths, nested internal paths, and production relative imports across package roots. New fixtures reject wildcard package exports and wildcard TypeScript paths. All other workspace packages already used explicit exports.
- Remaining: Run focused fixture tests, authoritative source/test typecheck, package README checks, lint, boundaries, and production build; then record exact results and mark WS-04 Done only if all pass.
- Blockers: None. This branch is intentionally stacked on WS-03 until the earlier protected-branch pull requests merge.
- Next action: Complete the worktree-local dependency install and run the WS-04 verification commands.

### 2026-09-04 — Amp — WS-04 verification complete

- Changed: Completed the explicit `@pivi/agent` export manifest, root TypeScript path cleanup, architecture policy/fixtures, and durable package/module-resolution documentation without adding a workspace, project references, or import rewrite.
- Evidence: Focused architecture suite passed (1 suite / 100 tests); full coverage passed (350 suites / 3,136 tests); dependency audit, source/test typecheck, lint, all boundary and package README checks, production build, bundle-size check, and `git diff --check` passed. Built `main.js` remained 4,169,451 bytes.
- Remaining: Commit and open the stacked WS-04 pull request. Continue WS-05 only after a measured ownership/dependency inventory and dedicated issue make its slice decision-complete.
- Blockers: The change remains stacked on PR #109, which itself is stacked on PR #108; retarget in order after earlier pull requests merge.
- Next action: Review the WS-04 diff, commit it, push the branch, and open a pull request targeting `refactor/pivi-application`.

### 2026-09-04 — Amp — WS-05 UI port factory split

- Changed: Linked issue [#111](https://github.com/shuuul/obsidian-pivi/issues/111) and moved `createSettingsUiPorts` into `src/app/ui/createSettingsUiPorts.ts` as a behavior-preserving extraction from `createUiPorts.ts`. `PiviSettingTabHost` and settings-factory tests now import the settings entrypoint; chat tests remain on `createUiPorts`. Other large files remain unsplit because each still owns one use-case family.
- Evidence: The original 590-line / 25,991-byte mixed factory became a 194-line / 8,610-byte chat adapter plus a 401-line / 17,637-byte settings adapter, with extracted function bodies byte-identical. Focused Jest passed (2 suites / 29 tests); full coverage passed (350 suites / 3,136 tests). Dependency audit, source/test typecheck, lint, all boundary checks, production build, bundle-size check, and `git diff --check` passed. Built `main.js` remained 4,169,451 bytes.
- Remaining: Do not split additional factories until a measured ownership seam exists; no additional current candidate justified a split.
- Blockers: None for this mechanical extraction.
- Next action: Commit the verified WS-05 change, push it, and open a stacked pull request targeting `refactor/curate-package-exports`.

### 2026-09-04 — Amp — WS-06 Pi compatibility lifecycle

- Changed: Created issue [#113](https://github.com/shuuul/obsidian-pivi/issues/113); cataloged ten upstream-shape-dependent Pi adaptations in `packages/engine-pi/compatibility-manifest.json`; added a manifest completeness/exact-pin gate; expanded `test:pi-compat` to cover the manifested shim, build, session, fetch, and transport contracts; and added a weekly/manual informational canary that updates one marker-backed issue comment.
- Evidence: Focused checker/workflow/build suites passed (3 suites / 13 tests); expanded pinned compatibility passed (11 suites / 44 tests); full coverage passed (352 suites / 3,143 tests); dependency audit, source/test typecheck, lint, all boundary checks, production build, bundle-size check, and `git diff --check` passed. The pinned build is 4,169,460 bytes. An isolated 0.85.0 dry run correctly failed four real session suites because upstream `pi-coding-agent` imports missing `@earendil-works/pi-server`; the stable issue comment records the blocker without modifying the pin.
- Remaining: Do not add a local dependency workaround. The scheduled route should retest the newest synchronized stable release after this workflow reaches `main`; an actual Pi bump remains a reviewed dependency change.
- Blockers: None for WS-06. Pi 0.85.0 itself is currently blocked by its published dependency graph.
- Next action: Open the verified WS-06 pull request, then inventory WS-07's existing bundle metadata and console-noise ownership.

### 2026-09-04 — Maintainer decisions for WS-08/WS-09 closeout

- Changed: The maintainer authorized merging [PR #108](https://github.com/shuuul/obsidian-pivi/pull/108), chose to keep weekly/monthly templates without committing to a publication cadence, and chose not to apply for GitHub Sponsors now.
- Evidence: GitHub Sponsors setup would require a supported region, 2FA, payout/tax onboarding, profile and tiers, and approval; no valid `shuuul` Sponsors profile currently exists. PR #108 passed all three required checks and merged as [`f66d234e`](https://github.com/shuuul/obsidian-pivi/commit/f66d234ec51309eafc609e1b24f96a76a7ed4e97). GitHub reports 100% community health and serves the contribution files, contact routes, recipe index, and platform matrix from `main`.
- Remaining: None for WS-08/WS-09; issue #105 is closed.
- Blockers: None.
- Next action: Reconcile the remaining stacked PRs with `main` and preserve this evidence through final archival.

## Completion summary

Pending. The WS-01 merge gate is satisfied. This spec remains Active until the remaining workstreams are either completed with evidence or explicitly deferred with an owner and reason.
