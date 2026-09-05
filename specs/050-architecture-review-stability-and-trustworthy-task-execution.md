---
id: "050"
title: "Architecture review stability and trustworthy task execution"
status: Draft
created: 2026-09-05
updated: 2026-09-05
coordinator: "Amp"
---

# 050 — Architecture review stability and trustworthy task execution

## Context

Turn the 2026-09-05 architecture review into bounded implementation slices without replacing the five-package architecture. Local `main` and the locally recorded `origin/main` both started at [22a283a](https://github.com/shuuul/obsidian-pivi/commit/22a283a4e4dfb36e71146ca8ff14a82e9642315d), Pivi 0.25.1; the worktree was clean. This spec is based on local source inspection, not a fresh claim about remote CI or runtime behavior.

| Review area | Verified source and contract | Evidence limit |
|---|---|---|
| Real-host smoke | `scripts/smoke-obsidian.mjs` expects `plugin.sessionStore/processRunner`; `src/main.ts` exposes neither. Notes bypass Pivi tools; JSONL is handwritten; fetch checks compare names/current aliases; cleanup is success-only. | No live run yet. Also, the configured vault is checked on disk but is not explicitly targeted by CLI calls; `obsidian --help` contradicts repository CLI guidance. |
| Fork and shutdown | `src/ui/chat/tabs/tabManagerFork.ts` creates/registers/updates before the outer catch and returns null tabs without rollback. `PiviApplication.onunload()` starts persistence, journal unbinding, and disposal independently. | Failure exits and ordering are statically visible; final disk residue/data loss is not reproduced. `persistOpenTabStates()` already uses `Promise.allSettled`; preserve it. |
| Projection | `dispatch()` remains the sole production ingress; text/tool/agent events call private `queueUpsert()`, which snapshots before replacing a pending item. `flushPendingMessages()` starts timing later. | Dispatch does not remove per-event snapshot cost. No measured latency, allocation reduction, or quadratic string-copy claim. |
| Read-only and recovery | `createObsidianTools.ts` registers mutation tools subject to settings; the literature recipe only requests no edits. `fileRecoverySnapshot.ts` is best-effort for md/canvas using existing internal `forceAdd`. | This is a product capability gap, not proof of an exploitable vulnerability. Existing recovery and approvals are not missing. |
| Package/docs contracts | `packages/agent/package.json` has no dependencies despite SDK imports in `mcpConnectionPool.ts`. Roadmap Now points to the pre-archive path for spec 049. | Root dependency installation can work; no standalone build failure is claimed. |

Keep Pi pins/compatibility checks, JSONL/journal recovery, device-local credentials, scoped network clients, entity subscriptions, imperative Markdown islands, quality gates, and community routes. Historical context: specs 035, 036, and 049 in `archive/`; do not reopen their completed scope wholesale.

## Goal and success criteria

Important failure paths are handled, a new user can finish one clearly bounded task, and a contributor can take one independently testable maintenance slice.

- [ ] WS-01: Real Obsidian smoke exercises a deterministic Pivi turn/tool mutation and semantic session restoration after reload, preserves fetch identity, and cleans only its own resources on success/failure. Candidate/environment evidence is recorded.
- [ ] WS-02: Fork failure injection covers every side-effect boundary; delayed/repeated/early shutdown preserves save dependencies and never clears a newer owner's journal. Source sessions remain unchanged.
- [ ] WS-03: Reproducible ingest/snapshot/entity-commit/render baselines exist for three workloads; any retained optimization demonstrates improvement with immutable snapshots and event ordering intact. A measured no-change conclusion is acceptable, not an invented speedup.
- [ ] WS-04: A user can run literature triage under an execution-enforced read-only mode; main/subagent/bypass attempts cannot mutate user files or external systems. Mutation recovery information distinguishes captured, unavailable, failed, and unsupported states without promising universal undo.
- [ ] WS-05: Owning packages declare third-party contracts, consumer resolution and active local-link checks reject regressions, and the contributor handoff identifies files, fixtures, and commands. Full local gates and final branch evidence pass before merge.

## Scope and non-goals

In scope:

- P1: repair real-host verification first, then fork compensation and instance-owned shutdown coordination.
- P2: measured projection improvement, a narrow read-only task flow and truthful recovery visibility, dependency/export/documentation contract checks.
- One integration branch, reviewable local commits, shared final verification, and durable handbook synchronization.
- Adjacent defects encountered during implementation may be fixed in separate bounded commits after recording a reproduction, owner, regression test, and scope impact here.

Not in scope:

- A sixth package, wholesale UI/state-library rewrite, independent SDK publication, or generic transaction/permission framework.
- A new backup system, universal undo, sandboxing arbitrary third-party plugins, or guarantees that Obsidian awaits `onunload(): void` or that force-quit finishes async work.
- New telemetry, provider credentials, real-provider calls in deterministic tests, or presenting a test provider as genuine AI output.
- Automatic release/version/tag changes. Do not weaken CI, hooks, coverage, or required branch protection to save cost.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
| --- | --- | --- | --- |
| 2026-09-05 | Work on `improve/architecture-review-followup`; keep intermediate commits local, open at most one final PR if the merge route requires it. | User requested small steps on one branch with a final merge, not a PR for each slice. Current CI runs on PR updates and pushes to main; a draft PR still incurs CI. | All |
| 2026-09-05 | P1 precedes P2. This umbrella remains Draft until WS-04 product choices below are settled; P1 contracts below are ready for implementation. | Do not pretend unresolved product semantics are decision-complete; a later decision must not prevent fixing known failure paths. | All |
| 2026-09-05 | Use a typed, explicit development/test harness in app composition, with deterministic provider injection only at the engine/provider boundary. Never re-expose services on `PiviPlugin`. | Exercise real assembly, tool policy, persistence, and presentation without a paid/network-dependent model or another lifecycle-shell contract. Production artifacts must exclude the harness/provider. | WS-01 |
| 2026-09-05 | Preserve current behavior outside the selected task mode; read-only enforcement must be deny-by-default for unclassified capabilities. | Prompt instructions and MCP read-only annotations alone do not establish execution safety. Existing approvals remain authoritative where applicable. | WS-04 |
| 2026-09-05 | Existing internal File Recovery integration stays best-effort; do not expand undocumented APIs without explicit permission. Any CSS change requires human visual sign-off before commit. | Avoid false recovery promises and visually regressive hit-box/layout changes. | WS-04 |

### Grill decision gate (before WS-04 implementation)

Use a focused interview only for choices code cannot settle. Record answers in Decisions before marking this spec Active; do not silently ship the recommendations as user-approved policy.

| Decision | Recommendation | Consequence requiring confirmation |
|---|---|---|
| Read-only scope and persistence | User selects it for a session; each turn captures the policy, children inherit it, restore/fork retain it, and mode changes apply only when idle. Existing sessions keep existing behavior. | Changing defaults or allowing mid-turn upgrades changes user expectations and safety. Define queued-turn handling explicitly. |
| Other presets | Ship only read-only research first; leave “review before modification” and “trusted automation” as named follow-ups, not misleading aliases for current grants. | A true review-before-write mode needs a separate confirmation/diff contract; spec 034 was reverted and must not be revived incidentally. |
| Read-only egress | Keep separately authorized model traffic and safe built-in reads; disable Bash, CLI command/eval, MCP calls, installers, configuration mutation, and unclassified extensions in this mode. | Read-only means no task-triggered user-content/external mutation, not zero Pivi session/journal writes or zero disclosure to the chosen provider. |
| Recovery presentation | Add per-tool affected-file and capture-status information plus instructions for the existing host recovery entry; do not implement automated restore yet. | If automated restore is required, first design version/conflict checks and an actually available restore API. |

## Workstreams

Coordinator owns this file and the index. Claim a row before implementation or delegation; shared app/runtime write targets run serially. Each row can contain several small commits, not several PRs.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | P1 typed real-host smoke, safety/cleanup regression tests, candidate evidence | Amp | In progress | None | Node 24 script tests; harness typecheck; designated-vault live smoke |
| WS-02 | P1 complete fork compensation and ordered instance shutdown | Amp | In progress | WS-01 harness available; final reload evidence rerun afterward | Fork fault matrix; lifecycle deferred promises; real-filesystem integration; live restore |
| WS-03 | P2 projection cost baselines and justified local optimization | Unassigned | Pending | P1 accepted | Fixed workloads, ownership/immutability regressions, before/after traces |
| WS-04 | P2 execution read-only task and recovery visibility | Unassigned | Blocked | Grill decisions; P1 accepted | Adversarial tool matrix, recipe walkthrough, recovery states, UI/i18n checks |
| WS-05 | P2 package/docs gates, contributor slice, final integration | Unassigned | Pending | P1 first; final integration depends on all retained scope | Consumer resolution and link fixtures; full local quality gates |

### WS-01 — Real-host behavior rather than shell probes

1. Fix CLI availability/help and explicit vault targeting first. Compare the running vault's canonical path to the intended disposable development vault before any write. Mismatch, absent harness, stale deployed bundle, or readiness timeout must fail without mutating content.
2. Define a versioned typed request/result contract implemented by app composition using existing session/chat handles and normal tool execution. The harness accepts only run-owned fixture operations, not arbitrary service access. Replace only provider output, not persistence/tool implementations; disable auxiliary provider requests during this deterministic run.
3. Retain the original `window.fetch` object in the same renderer realm before reload; compare by reference after both reloads. Create a Pivi session, run deterministic user/assistant/tool content, mutate a unique note through registered Pivi tools and policy, reload, reopen the durable session through Pivi, and compare restored roles/content/tool result and note contents. A file-exists check is supplemental only.
4. Maintain a run-owned resource ledger and `try/finally` cleanup. Record created note/session/tab/journal/index/harness resources; remove only owned artifacts, preserve pre-existing directories/settings/tabs, and report cleanup failures separately from the original failure. CLI errors throw instead of calling `process.exit()` inside helpers. Host loss/forced process death cannot guarantee immediate cleanup: retain a safe, ownership-checked retry record and never report success.
5. Add negative tests for vault mismatch, failed creation/tool call/reload/restore, same-name fetch replacement, and cleanup failure. Record commit plus dirty status, deployed artifact digest, Pivi/Obsidian/Electron/OS/Node versions, timestamp/timezone, test-provider label, assertions, and cleanup outcome. Production build must omit all test-provider/harness code; production lifecycle sanity is a separate evidence row.

### WS-02 — Fork consistency and shutdown ownership

Fork ownership starts at the first newly created JSONL file, not at the open-session ID. Trace the existing session facade/store before choosing the smallest owning use-case boundary; the UI must not import engine implementation or filesystem cleanup logic.

| Injected failure | Required result |
|---|---|
| Fork file creation fails, including partial write | No source mutation; storage layer cleans its own partial creation or records a diagnosable owned residual. |
| Registration fails after fork file creation | Delete only the newly forked durable file through the session owner; do not require an open-session ID to compensate. |
| Metadata/message update fails | Remove new registration and new file; preserve the primary error. |
| Tab creation returns null or throws | Both trigger compensation; null stays a normal failed-open result, exceptions remain errors. Clean any partially created binding through its owner. |
| Compensation fails or repeats | Continue remaining safe cleanup; missing resources count as already cleaned; log actionable owned identity, preserve primary failure, never fall back to deleting the source. |

Use repository fault-injection tests plus temporary real-filesystem integration to assert original bytes/hash, registration and new-file state. Mock call counts alone are not disk evidence. A permanent filesystem refusal is a diagnosed residual, not a claim of successful rollback.

Shutdown is an instance-owned single-flight protocol: reject new operations synchronously → stop/drain running tasks into persistable terminal state → flush runtime/session and captured tab state → release journal ownership → dispose dependent workspace resources. Capture required view handles/state synchronously before host teardown; do not depend on mounted DOM after unload. Preserve save-all-views behavior and retain recoverable journal state when saving fails.

Prefer injected journal ownership; if migration is unnecessarily broad, use a scoped ownership token with compare-and-release and prove that old shutdown cannot unbind or write through a new instance's journal. Do not merely delay a global `bindSessionJournal(null)`. Cover delayed saves, failed flush, repeated shutdown, unload during initialization, late initialization completion, immediate reload/new instance, and tasks completing during shutdown. Shell `onunload()` remains void; tests/harness may await the app shutdown promise, but force-quit recovery still depends on normal journal persistence.

### WS-03 — Measure before changing snapshot ownership

Extend existing development-only performance recording and `docs/11-chat-ui-evolution.md` fixtures, not a new state library. Measure dispatch/validation, snapshot construction, entity commit, and render/paint separately; document nested/inclusive spans to prevent double counting. Record snapshot calls and visited/cloned entities as allocation proxies, not measured bytes.

Use three checked-in fixed workloads: small text-only message, tool-heavy message, and nested subagent message. Pin fixture content/hash, event count/order, cadence, visible/hidden state, build flags, warmup and sample counts before comparison. Report median/p95 timing and run-to-run variability on the same machine/runtime; timing should not become a flaky Jest pass/fail threshold. Keep recorder code absent from production.

Optimize the measured dominant path with local delta application/structural sharing only after tracing mutable event ownership. Never store a live mutable message until the next frame without proving ownership. Tests must mutate producer input after dispatch, preserve historical frozen snapshots and unchanged entity identities, reject cross-session/stale sequences, and immediately flush terminal state in visible/hidden/pop-out realms. Retain an optimization only if the same workload demonstrates repeatable improvement without regression in the other fixtures; otherwise retain instrumentation and document why no behavior change is justified.

### WS-04 — One trustworthy task, truthful recovery

After the decision gate, implement policy in the existing capability/tool execution ownership path as well as registry filtering. Direct calls to previously registered tools, queued turns, subagents, and capability refresh must not bypass the selected restriction. No assistant/management tool may lift its own policy. Do not rely on names, prompts, or untrusted MCP annotations to classify side effects.

Acceptance matrix covers write/edit/delete/rename/property mutation, Bash, CLI command/eval, MCP calls with misleading read-only annotations, installation/configuration changes, child-tool calls, and restored/forked/queued sessions. Assert denied execution causes no file/process/network mutation; separately permit necessary Pivi session/journal bookkeeping. Existing external-read and network disclosure controls still apply.

Use the literature-triage recipe as the first task: a new user selects the mode, chooses three disposable reading notes, receives a linked table with missing-metadata flags, and can resume the result. Hash user-content fixtures before/after. Deterministic provider evidence tests wiring; a genuine model walkthrough, if authorized, is separately labeled and does not promise summary accuracy.

Expose structured capture outcomes from the existing File Recovery boundary and carry them to tool presentation without importing UI into host/tools. Show affected files and captured/unavailable/failed/unsupported states; do not label best-effort snapshots as guaranteed undo. Cover md/canvas, other extensions, disabled host recovery, capture rejection, and tool failure after capture. Bash/MCP effects explicitly have no general rollback promise. If restore is added by a recorded scope decision, reject stale versions rather than silently overwriting intervening user edits. UI copy and accessibility labels ship in all locales with the same commit.

### WS-05 — Enforce actual contracts and leave a contribution-ready slice

Declare third-party dependencies in the owning workspace packages and update the lockfile using Node 24 without upgrading unrelated versions. Extend the existing boundary checker to understand static imports, re-exports, literal dynamic imports, scoped package roots/subpaths, built-ins, runtime versus type-only dependencies, and explicit host peer contracts. Root hoisting is not proof of declaration. Preserve the sole engine-owned Pi SDK boundary; reconcile the root guide's blanket MCP wording with the existing agent-owned MCP implementation rather than moving it into the engine.

Add consuming-package resolution fixtures for approved public exports and reject undeclared/unexported imports; distinguish stable application entries from declared internal/test leaves without a broad breaking export cleanup. Add active Markdown relative-link checks to the existing docs gate: root/community docs, handbook/recipes, package docs/guidance, and active specs; exclude historical changelog/archive source links, but validate active links into archives. Cover inline/reference/image links, fragments, URL-encoded paths, and code-fence exclusions; do not introduce network-dependent external-link CI.

Prepare the relative-link checker as a contributor-ready task in existing contribution documentation: owner `scripts/`, input/exclusion contract above, failing archived-spec-link fixture, expected exit status/diagnostic, and local test commands. This is a handoff-ready repository task, not a requirement that an external volunteer actually implement it; publishing a GitHub issue is a separate action.

Correct the roadmap's obsolete Now item immediately; move 049 to completed history and link this execution plan. During closeout move completed items out, repair incoming archive links, and rerun checks. New adjacent findings must not turn this spec into an unlimited cleanup backlog; high-cost scope expansion goes through a recorded grill decision.

## Verification

Planning validation: `npm run check:specs`, `npm run check:docs-contracts`, and `git diff --check`. No product test is claimed by creating this spec.

Implementation commands (Node 24.x; default shell was Node 26.8.1 at inspection, while mise has Node 24 installed):

```bash
# Existing focused regression entrypoints; add new owning tests alongside them.
npm run test -- --runInBand tests/unit/features/chat/tabFork.test.ts
npm run test -- --runInBand tests/unit/main/pluginLifecycle.test.ts tests/unit/app/pluginLifecycle.test.ts tests/unit/app/serviceGraph.test.ts
npm run test -- --runInBand tests/unit/engine-pi/session/sessionCloudRecovery.test.ts
npm run test -- --runInBand tests/jsdom/pivi-react/chatUiStore.test.tsx tests/jsdom/pivi-react/MessageList.test.tsx tests/unit/architecture/chatProjectionEventPlane.test.ts
npm run test -- --runInBand tests/unit/host/obsidianVaultApi.test.ts tests/unit/scripts/checkDocsContracts.test.ts tests/unit/architecture/boundaryScripts.test.ts

# Full local pre-merge gates; do not replace them with targeted tests.
npm run check:dependencies && npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size
npm run test:platform-security
npm run test:pi-compat
npm run smoke:obsidian
npm run check:specs
```

The repaired smoke command must explicitly target and verify the designated test vault. Do not run today's unsafe smoke on a personal vault merely to gather a baseline. Build/deploy the correct harness-enabled artifact for deterministic smoke; separately verify the production artifact and test-code exclusion using the implemented build commands, recording those exact commands here before WS-01 is marked Done.

| Evidence row | Required evidence | Current state |
|---|---|---|
| Deterministic real-host chain | Fresh candidate/build identity, restored session/tool/note assertions, original fetch reference, success/failure cleanup | Not run |
| Fork and shutdown | Fault matrix results, original bytes, deferred-save event order, reload ownership | Not run |
| Performance | Fixed workload definitions and comparable before/after spans with variability | Not measured |
| Read-only and recovery | Adversarial matrix, new-user walkthrough, recovery status assertions, all-locale checks | Awaiting decisions |
| Final candidate | Full gates, inspected UI artifacts where applicable, docs sync, final CI for the merge candidate | Not run |

Human visual sign-off: if rendered CSS changes, the user must inspect the mode selector and affected-file/recovery disclosures, including hover/focus, all recovery states, light/dark themes, and a narrow sidebar after reload before commit. Agent rendering inspection/screenshots are additional evidence, not a substitute for that sign-off. Interaction-only changes require DOM/accessibility checks. No visual change is part of the initial spec-writing slice.

Execution sequence: local spec commit → WS-01 harness/script/test commits → WS-02 fork and shutdown commits → WS-03 measured slice → WS-04 agreed product slice → WS-05 contract checks/final integration. Each commit preserves relevant checks and evidence. Do not open/update intermediate PRs or bypass hooks; run full gates once the combined candidate is ready, then use the user's final merge route. If a P2 decision materially expands the batch, agree on deferral explicitly rather than hold P1 indefinitely. No release tag is part of this merge.

## Documentation sync

- Durable product/developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/05-tabs-sessions-and-history.md`, `docs/09-development-debugging-and-validation.md`, and `docs/11-chat-ui-evolution.md` for lifecycle/session/smoke/performance changes.
- Task/policy/recovery docs: `docs/07-tools-skills-mcp-and-integrations.md`, `docs/08-presentation-and-settings.md`, `docs/recipes/literature-triage.md`, and `SECURITY.md` only as actual behavior changes. Never advertise planned policy as shipped.
- Nearest local guidance: `scripts/AGENTS.md`, `src/app/AGENTS.md`, `src/ui/chat/AGENTS.md`, and `tests/AGENTS.md` when commands/maps/invariants change.
- Package guidance: affected `packages/*/AGENTS.md`, package READMEs, and locale/style guidance only where the implementation invalidates them; keep stable API/dependency ownership there.
- Root guidance and roadmap: repair `docs/10-roadmap-release-and-maintenance.md` now; synchronize `AGENTS.md` for changed enforceable contracts and `CONTRIBUTING.md` for the bounded handoff. No version/changelog churn for this planning slice.

## Progress and handoff

### 2026-09-05 — Amp — Planning

- Changed: reserved spec 050 and created local branch `improve/architecture-review-followup`; mapped all five review findings to owners, failure contracts, acceptance evidence, and a single-branch sequence.
- Evidence: local HEAD exactly matches the reviewed commit; source inspection confirms the principal findings. Additional smoke vault-target/help issues and root MCP guidance mismatch are included in their owning workstreams. No repository runtime tests or live smoke were executed for this planning slice.
- Remaining: implementation and every acceptance checkbox above; no performance/security/data-loss claim is established by this spec.
- Blockers: WS-04 policy/product choices require the focused grill gate before implementation. P1 is not blocked by those choices.
- Next action: begin WS-01 under Node 24 by reading the current app composition/test harness patterns and verifying a disposable target vault before any host mutation. Record the concrete harness/build contract and scoped regression results here.

### 2026-09-05 — Amp — Planning validation

- Passed: `mise exec node@24.19.0 -- npm run check:specs`, `mise exec node@24.19.0 -- npm run check:docs-contracts`, and `git diff --check`.
- Synced: the spec index and roadmap now point to spec 050; spec 049 links to its archived path and is no longer described as current work.
- State: documentation changes only, not committed or pushed; no PR, merge, deployment, or release was performed. All implementation acceptance remains open.

### 2026-09-05 — Amp — WS-01 smoke safety slice

- Changed: the transitional runner now targets `OBSIDIAN_VAULT` explicitly, verifies its canonical host path before every renderer operation, uses a finite CLI timeout, rejects the unavailable legacy service contract before reload or fixture mutation, retains the original fetch object across reloads, reserves UUID fixture files exclusively, and attempts all run-owned cleanup without deleting shared directories.
- Evidence: Node 24 focused Jest passed 8 safety cases covering vault mismatch, absent harness, targeting/timeout, same-name fetch replacement, success/failure cleanup, sibling cleanup continuation, and CLI timeout. `typecheck:tests`, focused zero-warning ESLint, `check:specs`, `check:docs-contracts`, and `git diff --check` passed.
- Limit: the CLI double is not real-host evidence. The legacy success branch still writes raw files and is explicitly non-acceptance; current lifecycle-only production builds stop before that branch. No designated vault was mutated.
- Next action: replace the legacy probe/raw fixtures with the versioned app-composition harness and deterministic provider path, then add stale-bundle/readiness/tool/restore failure coverage before any live run.

### 2026-09-05 — Amp — WS-01 typed harness slice

- Changed: added the version-1 semantic view command, app-owned run/inspect/cleanup orchestration, and an engine-local model/auth/stream override used only by a development application surface. The deterministic pi-ai faux stream requests the registered `obsidian_write` ToolSpec; ordinary Pi Agent execution, tool policy, JSONL persistence, semantic hydration, and Obsidian vault mutation remain real.
- Safety: requests accept only exact UUID-derived smoke note/ledger paths and safe session paths. An exclusive ledger records session ownership before the turn; failed turns roll back, explicit cleanup verifies the complete ledger and continues sibling cleanup, and incomplete/unknown cleanup retains it for retry. The CLI compares semantic roles/content/tool result/note bytes after reload and retains the original fetch object across both reloads.
- Evidence: Node 24 source/test typecheck passed; focused harness, CLI-double, and injected-provider tests passed; an in-memory production build was 4,170,384 bytes and contained none of `Pivi deterministic smoke`, `pivi-smoke-tool-`, `runRealHostSmoke`, `createFauxCore`, or `Pivi smoke harness`. No artifact was deployed and no designated vault was mutated.
- Remaining: run architecture/docs/spec gates after final review, then obtain authorization to deploy a development artifact to the designated disposable vault and record the required real-host environment/digest/cleanup evidence. Production lifecycle sanity remains a separate evidence row.

### 2026-09-05 — Amp — WS-02 local implementation

- Changed: fork ownership now begins at the new JSONL and compensates registration, metadata update, null-tab, and thrown-tab failures through a dedicated physical-discard session-owner port. Open-registration and file cleanup continue independently, while compensation logging preserves the primary failure.
- Shutdown: `PiviApplication.shutdown()` is a single-flight promise. It rejects new work synchronously, starts all semantic view shutdowns, captures tab bindings once, cancels active turns, attempts every session save and tab teardown, releases an owner-token journal binding, then disposes workspace resources. A later host close cannot overwrite captured bindings with an empty manager, and an old instance cannot clear a newer journal owner.
- Evidence: Node 24 source/test typecheck; focused zero-warning ESLint; architecture/docs/spec/package/i18n/Pi boundaries; 7 focused suites / 134 tests covering fork fault boundaries, cleanup continuation, deferred save order, save-failure teardown, repeated shutdown, late initialization disposal, and stale journal release. The full Jest run passed 355 suites / 3,173 tests; one build-compatibility worker was externally terminated by `SIGSEGV`, and its 7 tests passed immediately in an isolated in-band run. Existing engine tests exercise production-path source fingerprint rejection and real temporary JSONL bytes; a designated-vault restore remains unrun.
- Remaining: obtain explicit authorization before deploying/running the development real-host smoke. Record live reload/restore and cleanup evidence before marking WS-01 or WS-02 Done.

## Completion summary

Not completed. Spec creation is not implementation acceptance. Before archival, close or explicitly revise every criterion through a decision, record candidate evidence, sync durable docs, set Completed/update the date, archive the unchanged filename, update incoming links and the index, and run `npm run check:specs` before and after archival.
