---
id: "050"
title: "Architecture review stability and trustworthy task execution"
status: Completed
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
| Trusted automation recovery | `createObsidianTools.ts` executes enabled mutations directly. `fileRecoverySnapshot.ts` used internal `forceAdd` for md/canvas but silently continued when recovery was unavailable or failed; move, delete, and history restore bypassed it. | Trusted automation remains the sole execution model. The gap is fail-open recovery coverage, not a missing permission mode. |
| Package/docs contracts | `packages/agent/package.json` has no dependencies despite SDK imports in `mcpConnectionPool.ts`. Roadmap Now points to the pre-archive path for spec 049. | Root dependency installation can work; no standalone build failure is claimed. |

Keep Pi pins/compatibility checks, JSONL/journal recovery, device-local credentials, scoped network clients, entity subscriptions, imperative Markdown islands, quality gates, and community routes. Historical context: specs 035, 036, and 049 in `archive/`; do not reopen their completed scope wholesale.

## Goal and success criteria

Important failure paths are handled, a new user can finish one clearly bounded task, and a contributor can take one independently testable maintenance slice.

- [x] WS-01: Real Obsidian smoke exercises a deterministic Pivi turn/tool mutation and semantic session restoration after reload, preserves fetch identity, and cleans only its own resources on success/failure. Candidate/environment evidence is recorded.
- [x] WS-02: Fork failure injection covers every side-effect boundary; delayed/repeated/early shutdown preserves save dependencies and never clears a newer owner's journal. Source sessions remain unchanged.
- [x] WS-03: Reproducible ingest/snapshot/entity-commit/render baselines exist for three workloads; any retained optimization demonstrates improvement with immutable snapshots and event ordering intact. A measured no-change conclusion is acceptable, not an invented speedup.
- [x] WS-04: Trusted automation blocks every supported existing-file mutation unless Obsidian File Recovery first captures the current version; move/delete cover folder descendants atomically and history restore snapshots the current destination before replacement.
- [x] WS-05: Owning packages declare third-party contracts, consumer resolution and active local-link checks reject regressions, and the contributor handoff identifies files, fixtures, and commands. Full local gates and final branch evidence pass before merge.

## Scope and non-goals

In scope:

- P1: repair real-host verification first, then fork compensation and instance-owned shutdown coordination.
- P2: measured projection baselines, strict File Recovery for Trusted automation, dependency/export/documentation contract checks.
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
| 2026-09-05 | P1 precedes P2. The umbrella became Active once WS-04 product choices were settled. | Keep implementation ordered while recording product semantics before changing the recovery contract. | All |
| 2026-09-05 | Use a typed, explicit development/test harness in app composition, with deterministic provider injection only at the engine/provider boundary. Never re-expose services on `PiviPlugin`. | Exercise real assembly, tool policy, persistence, and presentation without a paid/network-dependent model or another lifecycle-shell contract. Production artifacts must exclude the harness/provider. | WS-01 |
| 2026-09-05 | Pivi has one execution model: Trusted automation. Do not add Read-only, Review-before-write, a mode selector, or recovery UI. | The user explicitly rejected execution presets and per-write review; reliability comes from recoverable mutations rather than interaction gates. | WS-04 |
| 2026-09-05 | Strict scheme B: before modifying, overwriting, appending, prepending, changing properties, moving, deleting, or restoring an existing `.md` / `.canvas`, private File Recovery `forceAdd` must succeed or the operation is blocked. | A failed or unavailable snapshot must never be presented as recoverable. New files/folders have no prior version. | WS-04 |
| 2026-09-05 | Folder move/delete recursively snapshots all supported descendants before any host mutation; one failure aborts the whole operation. Unsupported attachments retain existing rename/trash behavior and are not claimed as File Recovery history. | This preserves atomic preflight for recoverable content without treating binary data as text; Obsidian Trash remains the delete recovery path for attachments. | WS-04 |
| 2026-09-05 | Keep `obsidian_history` list/read/restore. Restoring over an existing supported file snapshots its current state first; restoring a deleted path has no current state to capture. | The Agent can undo a restore through history without adding another UI or recovery store. | WS-04 |

## Workstreams

Coordinator owns this file and the index. Claim a row before implementation or delegation; shared app/runtime write targets run serially. Each row can contain several small commits, not several PRs.

| ID | Deliverable | Owner | Status | Dependencies | Verification |
| --- | --- | --- | --- | --- | --- |
| WS-01 | P1 typed real-host smoke, safety/cleanup regression tests, candidate evidence | Amp | Done | None | Node 24 script tests; harness typecheck; designated-vault live smoke |
| WS-02 | P1 complete fork compensation and ordered instance shutdown | Amp | Done | WS-01 harness available; final reload evidence rerun afterward | Fork fault matrix; lifecycle deferred promises; real-filesystem integration; live restore |
| WS-03 | P2 projection cost baselines and justified local optimization | Amp | Done | P1 accepted | Fixed workloads, ownership/immutability regressions, three-run real-host traces |
| WS-04 | P2 strict File Recovery for Trusted automation | Amp | Done | Product decisions settled; P1 accepted | Host/tool failure matrix, recursive preflight, restore ordering, docs/contracts |
| WS-05 | P2 package/docs gates, contributor slice, final integration | Amp | Done | P1 first; final integration depends on all retained scope | Consumer resolution and link fixtures; full local quality gates |

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

### WS-04 — Strict File Recovery for Trusted automation

Keep direct Trusted automation and enforce recovery at the host mutation boundary rather than through registry filtering, prompt advice, approval modes, or UI. `fileRecoverySnapshot.ts` must fail closed for supported files when the core plugin is disabled/unavailable, private `forceAdd` is missing, content read fails, or capture rejects. Errors must identify the blocked path and recovery requirement. New files/folders skip capture because there is no prior version; unsupported attachments remain outside the File Recovery guarantee.

Cover every existing supported mutation path: exact edit, overwrite, append/prepend, property set/remove, move, delete, and history restore. File and folder move/delete must finish all recursive `.md` / `.canvas` captures before calling `renameFile` or `trashFile`; a partial set of successful snapshots is harmless, but no vault mutation may occur after any preflight failure. Moving an unsupported file remains available; deleting it still goes through Obsidian Trash.

Keep `obsidian_history` as the Agent recovery surface. Before CLI restore, validate the mutation path and ask the host to snapshot a current supported destination. If the path is currently deleted, proceed without pre-capture. A failed required snapshot prevents the CLI call. No recovery status presentation, mode selector, locale work, CSS, or new recovery UI belongs in this slice.

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
| Deterministic real-host chain | Fresh candidate/build identity, restored session/tool/note assertions, original fetch reference, success/failure cleanup | Passed 2026-09-05 14:33 CST; development artifact SHA-256 `f57920262198cced59e1eb0ae1699707f19bc619a735248b0181762a653cc524` |
| Fork and shutdown | Fault matrix results, original bytes, deferred-save event order, reload ownership | Passed: local fault/lifecycle matrix, temporary-filesystem partial-write cleanup/residual diagnosis, exact source bytes, and real-host reload/restore |
| Performance | Fixed workload definitions and comparable before/after spans with variability | Passed: nine corrected real-host traces; projection ownership p95 ≤0.10 ms; no optimization retained |
| Trusted automation recovery | Required-snapshot failure matrix, recursive preflight, restore ordering, unsupported-file boundary | Passed: 50 focused tests; full 357-suite / 3,200-test Jest run; typecheck, lint, boundaries, docs/spec, production build, bundle-size gates, and designated-vault production smoke |
| Final candidate | Full gates, inspected UI artifacts where applicable, docs sync, final CI for the merge candidate | Passed locally: dependency audit, typecheck, lint, boundaries, 357-suite coverage, platform/Pi compatibility, production build/size, deterministic Obsidian smoke, production reload |

WS-04 has no visual surface: no mode selector, recovery disclosure, locale copy, or CSS is added. Visual sign-off is therefore not applicable. If a later slice changes rendered UI, it must follow the repository's render-and-inspect requirement.

Execution sequence: local spec commit → WS-01 harness/script/test commits → WS-02 fork and shutdown commits → WS-03 measured slice → WS-04 agreed product slice → WS-05 contract checks/final integration. Each commit preserves relevant checks and evidence. Do not open/update intermediate PRs or bypass hooks; run full gates once the combined candidate is ready, then use the user's final merge route. If a P2 decision materially expands the batch, agree on deferral explicitly rather than hold P1 indefinitely. No release tag is part of this merge.

## Documentation sync

- Durable product/developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/05-tabs-sessions-and-history.md`, `docs/09-development-debugging-and-validation.md`, and `docs/11-chat-ui-evolution.md` for lifecycle/session/smoke/performance changes.
- Task/policy/recovery docs: `README.md` and `docs/07-tools-skills-mcp-and-integrations.md` describe Trusted automation and strict File Recovery only after implementation. No mode, presentation, recipe, locale, or security-boundary docs change for WS-04.
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
- Remaining: live smoke authorization was granted and evidence follows below. WS-02 still needs storage-owned handling for a fork API that fails after partial file creation.

### 2026-09-05 — Amp — WS-01 live acceptance

- Candidate: local commit `37c939d76ba04ee320f12167b3eef170dd0abef0`; development `main.js` SHA-256 `f57920262198cced59e1eb0ae1699707f19bc619a735248b0181762a653cc524`; Pivi 0.25.1; Obsidian 1.13.7 / installer 1.14.0; Electron 43.3.0; renderer Node 24.18.1; Chrome 150.0.7871.212; macOS 27.0 arm64; 2026-09-05 14:33 CST.
- First run: failed safely before note/session creation because the runner still looked up the retired `pivi-chat` view type while the registered constant is `pivi-view`. Corrected the lookup and added a source-contract regression; the 11-case CLI safety suite and focused ESLint passed.
- Live result: `npm run dev` deployed byte-identical root/Vault artifacts, then `npm run smoke:obsidian` passed the deterministic Pi turn, registered `obsidian_write`, semantic role/content/tool-result checks, two plugin reloads, durable reopen, exact note bytes, and original `window.fetch` reference checks. `obsidian dev:errors` reported no captured errors.
- Cleanup: the UUID note, ownership ledger, JSONL session, and retained fetch key were all absent after the run. No pre-existing `.pivi-smoke` files or shared directories were removed.
- State: WS-01 accepted. WS-02 retains one explicit gap: storage-owned diagnosis/cleanup for a fork API that fails after partially creating a file; do not claim that boundary from downstream compensation tests.

### 2026-09-05 — Amp — WS-02 partial-fork closure

- Changed: both production fork entry points now compensate a pinned Pi `SessionManager` failure that changes its session path before completing the new JSONL. Cleanup accepts only that exact same-session-directory `.jsonl` candidate, never scans sibling sessions, and reopens the unchanged source manager for a live store.
- Failure contract: successful cleanup rethrows the original error object. Cleanup refusal/failure retains the exact owned path in an `AggregateError`; a source reopen failure is also aggregated instead of replacing the fork error.
- Evidence: temporary-filesystem fault injection writes partial bytes before throwing, asserts byte-for-byte unchanged source content, candidate absence, primary-error identity, and source-manager restoration. Separate cases prove pre-mutation failures do not delete/reopen the source and cleanup failure leaves a diagnosed residual. Node 24 focused tests, typecheck, lint, boundaries, and diff checks passed.
- State: WS-02 accepted. WS-03 is the next unblocked workstream; WS-04 remains blocked on product decisions.

### 2026-09-05 — Amp — WS-03 granular measurement harness

- Changed: development trace schema v2 adds separate accepted/rejected dispatch validation, inclusive dispatch, snapshot construction, and entity-commit events while preserving commit/paint, Markdown, rows, long-task, and heap evidence. Snapshot events record one call plus recursively visited/cloned entity counts as allocation proxies, not bytes.
- Fixtures: checked-in small-text, 12-tool, and one-subagent/eight-nested-tool messages have pinned SHA-256 values. Each isolated main-window workload performs 5 unrecorded warmups, then 50 measured accepted events at one event per visible animation frame and stops tracing before cleanup. One command exports all three; the summarizer reports per-trace and cross-run median/p95/ranges.
- Semantics: inclusive spans and nesting are documented so snapshot or entity time is not double-counted. Existing ownership tests retain accepted frozen snapshots after producer mutation, preserve unchanged entity identities, reject stale/cross-owner events, and flush terminal state across visible, hidden, and migrated owner realms.
- Remaining at this checkpoint: deploy the development candidate to the designated vault, run the suite three times, summarize nine traces, and use the measured dominant phase to decide whether a local structural-sharing optimization is justified.

### 2026-09-05 — Amp — WS-03 measured no-change acceptance

- Candidate: local worktree atop `0ca951368aca3c21ef081808b65da8421b048537`; byte-identical root/designated-vault development artifact SHA-256 `d25454eddd9384004ae73ed75512442bd3b9b9e25674d9c01431bf2243f37219`; Pivi 0.25.1; Obsidian CLI `1.14.0 (installer 1.13.7)`; Electron 43.3.0; renderer Node 24.18.1; Chrome 150.0.7871.212; macOS arm64.
- Measurement: three visible main-window runs produced nine corrected traces (`2026-09-05T07-10-06-845Z` through `07-10-17-372Z`). Every trace records the pinned fixture hash, 5 excluded warmups, and exactly 50 accepted fixture dispatch/snapshot/entity-commit/projection-commit/paint events. Obsidian captured no errors.
- Results: small text event-to-paint median/p95 15.20/16.10 ms with per-run median range 15.00–15.40 ms; tool-heavy 16.20/17.00 ms and 16.10–16.20 ms; nested subagent 15.70/16.80 ms and 15.70–15.70 ms. Every dispatch-validation, inclusive-dispatch, snapshot, and entity-commit p95 is ≤0.10 ms. Snapshot proxies are stable at 9/3, 142/40, and 98/25 visited/cloned values per event. Small-text Markdown render is the largest local phase at 0.70/0.90 ms median/p95.
- Correction: an earlier nine-trace attempt exposed that wall-clock trace start could be ahead of Chromium's monotonic epoch, clamping relative/paint spans to zero. Those traces are excluded. The recorder now anchors elapsed spans to the owner window's `performance.timeOrigin + performance.now()`, and a regression asserts a 25 ms synthetic monotonic interval.
- Decision: retain no structural-sharing/delta optimization. Projection ownership phases are below the 0.10 ms clock resolution at p95, end-to-end behavior is one frame, and the dominant Markdown phase is outside snapshot ownership. Adding mutable-event risk would invent a speedup rather than respond to a measured bottleneck. Instrumentation remains for future comparisons; WS-03 is accepted.
- Production exclusion: the Node 24 production artifact is 4,140,651 bytes and contains none of the trace schema, trace directory, trace-start copy, or projection-suite command ID. The bundle-size gate retains 1,102,229 bytes of headroom.
- Verification: Node 24 source/test typecheck, zero-warning ESLint, all architecture/docs/package/i18n/spec/Pi boundaries, production build/size checks, and the full 357-suite / 3,191-test in-band Jest run passed. One first full run had the expected architecture source-contract fixture mismatch plus a load-sensitive 30 ms HTTP timing failure; the fixture was updated, the HTTP test passed without parallel gate contention, and the complete isolated rerun was green.

### 2026-09-05 — Amp — WS-04 strict recovery decision and implementation

- Decision: Pivi remains Trusted automation only. Read-only, Review-before-write, mode selection, recovery presentation, and per-write confirmation are removed from this spec. The user authorized the private File Recovery API and selected strict scheme B.
- Changed: existing `.md` / `.canvas` edit/write/property/move/delete paths now require successful `forceAdd`; disabled/unavailable recovery, a missing private API, or capture failure blocks the host mutation. Folder move/delete recursively captures supported descendants before calling Obsidian. New files/folders skip capture; unsupported attachments retain rename/trash behavior without a File Recovery claim.
- Restore: `obsidian_history restore` validates the path, snapshots a current destination through the host, then invokes the CLI. Deleted destinations proceed because no current version exists; failed required capture prevents the CLI call.
- Runtime compatibility: read-only inspection of designated-vault Obsidian 1.13.7 confirmed the enabled `file-recovery` instance exposes `forceAdd` as a function. No plugin reload or mutating smoke was run for this slice.
- Evidence: focused Node 24 host/history suites passed 50 tests. Full 357-suite / 3,200-test Jest, source/test typecheck, zero-warning lint, dependency audit, architecture/docs/package/i18n/spec/Pi boundaries, production build, and 4,141,383-byte bundle-size gate passed. WS-04 is accepted locally.

### 2026-09-05 — Amp — WS-04 production smoke

- Candidate: local commit `6f794440`; production root and designated-vault `main.js` SHA-256 `554ba2ff8d1377f5a1b7e7d2363bfc2da9f66f9a6e6ac80832a560a40e898d13`; Obsidian CLI 1.14.0 / installer 1.13.7; smoke completed 2026-09-05 15:44 CST.
- Reload: the production plugin reloaded successfully in the canonical `/Users/shuuul/obsidian/Base` vault, and every renderer operation guarded that exact real path. The loaded application exposed the production `createVaultApi()` host boundary.
- Mutation and history: production `ObsidianVaultApi.editNote()` changed one UUID root note from `before-*` to `after-*`; File Recovery immediately exposed the exact `before-*` bytes as history. Production `captureSnapshotBeforeRestore()` then captured the current `after-*` bytes, and the real CLI restore boundary restored the earlier version to exact `before-*` content.
- Safety and cleanup: an initial hidden-directory fixture was not indexed by Obsidian, so Pivi rejected it as missing before snapshot or mutation; the fixture was removed. The successful root fixture was permanently removed and verified absent from both adapter storage and the Vault index. Its File Recovery versions intentionally remain subject to Obsidian retention so the recovery assertion is durable.
- Result: `obsidian dev:errors` reported no captured errors after reload, mutation, history reads, restore, and cleanup. Together with the focused tool-ordering tests, this accepts the production strict-recovery path without adding a mode or UI.

### 2026-09-05 — Amp — WS-05 contracts and final integration

- Package ownership: `@pivi/agent` now directly declares its `@modelcontextprotocol/sdk` runtime dependency and the lockfile records the workspace declaration. The architecture gate classifies static imports, re-exports, and literal dynamic imports; distinguishes runtime from type-only declarations; requires Obsidian/Electron/React host runtimes as peers; and rejects root-hoist reliance.
- Resolution: every explicit workspace export must resolve through an installed npm workspace link targeting the local package. Positive consumer fixtures cover stable application/package leaves; negative fixtures cover undeclared dependencies, runtime-only dev declarations, host peer drift, missing local links, and unexported internals.
- Documentation: the existing docs contract gate now validates inline, reference, and image relative links plus URL-encoded paths and Markdown fragments across root/community docs, handbook/recipes, package docs/guidance, and active specs. Fenced/inline code, changelog, and archived-spec source history are excluded, while active links into archived evidence remain checked. `CONTRIBUTING.md` records the exact owner, archive-link fixture, diagnostic, and focused commands.
- Local gates: Node 24 dependency audit, source/test typecheck, zero-warning lint, all architecture/docs/package/i18n/spec/Pi boundaries, 357-suite / 3,212-test coverage, 12-suite / 197-test platform-security, and 11-suite / 44-test Pi compatibility passed. Focused architecture/docs fixtures passed 123 tests.
- Host/build: the final development artifact SHA-256 `5ef51b92dbbd7e3ffd027e6dd4051cdad32d2c8e060458a4ebfbd3a8695c75cc` passed the canonical-vault deterministic Pi turn/reload/restore smoke and removed its note/session fixtures. The production build is 4,141,383 bytes; root and designated-vault SHA-256 are `554ba2ff8d1377f5a1b7e7d2363bfc2da9f66f9a6e6ac80832a560a40e898d13`. Production reload succeeded and Obsidian captured no errors.
- Visual scope: no rendered UI, CSS, locale, or interaction changed in WS-05, so visual inspection is not applicable. No push, PR, merge, tag, release, or publication was performed.

## Completion summary

Completed all five workstreams: deterministic real-host verification, transactional fork/shutdown handling, measured projection baselines with no unjustified optimization, strict File Recovery for Trusted automation, and enforceable package/documentation contracts. Final local quality gates and both development/production Obsidian lifecycle checks passed; run remote CI through the user's chosen merge route before merging.
