# Development, debugging, and validation

[Back to the developer handbook](README.md)

Validation should match the risk of the change. Start with the smallest focused test, then run the repository gates required by the affected boundary.

## Command matrix

| Task | Command |
|---|---|
| Install exact dependencies | `npm ci` |
| Watch bundle and CSS | `npm run dev` |
| Build CSS | `npm run build:css` |
| Typecheck source and tests | `npm run typecheck` |
| Lint with zero warnings | `npm run lint` |
| Documentation capability contracts | `npm run check:docs-contracts` |
| Architecture/docs/package/i18n/spec/Pi-pin guards | `npm run check:boundaries` |
| Exact synchronized Pi pins | `npm run check:pi-pins` |
| Pi compatibility manifest lifecycle | `npm run check:pi-compatibility` |
| All Jest projects | `npm run test` |
| Coverage and thresholds (global + security-module branches) | `npm run test:coverage` |
| Pi upgrade compatibility gate | `npm run test:pi-compat` |
| Focused path/process/MCP/Skills platform suite | `npm run test:platform-security` |
| Real Obsidian/Electron lifecycle smoke | `npm run smoke:obsidian` |
| Production bundle and deploy | `npm run build` |
| Bundle inspection metadata | `npm run analyze:bundle` |
| Bundle-size ceiling | `npm run check:bundle-size` |
| Privacy-safe session diagnostics | `npm run audit:sessions -- <vault-or-sessions-dir>` |

Always run Jest through the npm wrapper:

```bash
npm run test -- tests/unit/features/chat/inputTurnSubmission.test.ts
npm run test -- --runInBand tests/unit/engine-pi/runtime/piBackgroundSubagentJobs.test.ts
npm run test -- -t "test name"
```

`scripts/run-jest.js` supplies the Node local-storage file and repository setup. Direct Jest invocation can produce misleading failures. Shared setup fails the owning test on unexpected `console.warn` or `console.error`; tests for intentional recovery/degradation logs must mock and assert that call locally. React tests must await state-producing effects inside `act` rather than suppressing the warning.

`check:architecture` also guards the hardened tool ownership seams: `@pivi/agent`-owned `pivi_sessions` factory/recovery identifiers may not reappear under `@pivi/obsidian-tools`, and the existing package dependency rules prevent `@pivi/agent` from depending on `@pivi/engine-pi` or concrete host/tool adapters. `check:docs-contracts` keeps current capability claims aligned with `docs/capabilities.json` while allowing historical records and negative compatibility statements. `check:package-readmes` keeps package API claims aligned with those exports.

`audit:sessions` is read-only. It separates `perf-*` fixtures from real behavior and reports aggregate tool errors, Bash policy retries, malformed JSONL, oversized results/sessions, and message-UI overlay amplification. Add `--json` for machine-readable output. Reports intentionally omit user text, tool arguments, target entry IDs, and JSONL content; findings are diagnostic and do not cause a failing exit status.

## Feature test index

| Area | Starting points |
|---|---|
| Lifecycle/composition | `tests/unit/main/pluginLifecycle.test.ts`, `tests/unit/app/ui/imperativeChatAdapter.test.ts` |
| Input and queue | `tests/unit/features/chat/inputTurnSubmission.test.ts`, `inputStreamingQueue.test.ts`, `inputControllerLifecycle.test.ts` |
| Prompt layers | `tests/unit/agent/runtime/buildTurnPrompt.test.ts` |
| Tabs and restore | `tests/unit/features/chat/tabManagerLifecycle.test.ts`, `sessionControllerLifecycle.test.ts`, `sessionSwitch.test.ts` |
| External context privacy | `tests/unit/features/chat/tabExternalContext.test.ts`, `tests/unit/app/deviceLocalExternalContextStore.test.ts`, Pi session-store tests |
| Subagents | `tests/unit/engine-pi/tools/createSubagentTool.test.ts`, `piBackgroundSubagentJobs.test.ts`, `subagentConcurrencyLimiter.test.ts` |
| React chat/settings | `tests/jsdom/pivi-react/ChatShell.test.tsx`, `AssistantContentView.test.tsx`, `activityPresentation.test.ts`, `chatUiStore.test.tsx`, `SettingsUi.test.tsx`, `PiviSettingTabHost.test.ts` |
| Owner-realm DOM | `tests/jsdom/pivi-react/OwnerRealmDom.test.ts`, `DefaultVaultSkillsPrompt.test.ts`, `tests/jsdom/app-ui/createStreamingMarkdownContentAdapter.test.ts` |
| Tools and MCP | Relevant suites under `tests/unit/agent/tools/`, `tests/unit/engine-pi/tools/`, `tests/unit/agent/mcp/`, `tests/unit/host/systemProcessRunner.test.ts`, plus `tests/unit/agent/mcp/mcpToolBridge.test.ts` and `tests/jsdom/pivi-react/McpToolsSection.test.tsx` |

Use `rg --files tests | rg <feature>` to locate the current exact filename; test names move as ownership is refined.

## Debugging in Obsidian

For user-visible UI or runtime work:

```bash
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
```

Use a configured development vault (`.env.local` `OBSIDIAN_VAULT`). Official CLI commands target the vault of the current working directory, or `vault=<name>`; `obsidian --help` is not a valid invocation. Verify the main window and a pop-out when changing element-bound DOM, timers, scrolling, portals, or tooltips. Include Hover Editor when changing view lifecycle. Test Source mode and Live Preview for editor integrations.

### Deterministic host smoke

`npm run smoke:obsidian` requires the Obsidian CLI and `OBSIDIAN_VAULT`. **The current lifecycle-only build does not satisfy the script's legacy service probe.** It now fails before reload or fixture writes instead of leaving a note behind. The typed application harness and genuine Pivi turn/restore assertions are still being implemented under spec 050; do not use the legacy probe as candidate-release evidence.

The runner uses the configured vault as its working directory, passes an explicit vault selector, and checks the host's canonical vault path before renderer operations, including cleanup. CLI calls time out after 30 seconds. Legacy fixture runs require existing `.pivi-smoke/` and `.pivi/sessions/` directories, reserve UUID-named files exclusively, retain the original fetch function object across reloads, and attempt all owned-file/reference cleanup in `finally`. They neither open extra chat tabs nor delete shared directories. Cleanup errors fail the run while preserving the primary error; host loss or a timed-out renderer operation can leave residual resources and is not a successful cleanup guarantee.

`npm run test -- --runInBand tests/unit/scripts/smokeObsidian.test.ts` exercises these safety paths with a CLI double and temporary disk vaults. It is not a real Obsidian test and does not validate Pivi tools, JSONL restoration, or deterministic provider assembly. Even successful legacy raw-file checks do not prove those behaviors.

Useful symptom routes:

| Symptom | Inspect first |
|---|---|
| Surface does not open or retries indefinitely | registration order, workspace single-flight generation, `PiviViewHost` guards |
| First send fails but blank tab worked | lazy `tabRuntime` creation, model readiness, session binding |
| Wrong content in history/provider request | `ChatTurnRequest`, prompt preparation, API-only transforms |
| External paths appear in synced data | device-local store, settings codec, `message_ui` sanitizer |
| A stream updates the wrong tab/turn | stream generation, active-turn ownership, late chunk listener |
| Tab restores without messages/title | layout `sessionFile`, open-session hydration, JSONL metadata |
| Subagent card stalls | limiter/job state, ID correlation, terminal hydration retries |
| MCP slash entry is stale | settings save/reload invalidation, HTTP/SSE prefetch, catalog refresh |
| UI works in main window only | owner document/window lookup and global timer/listener use |

Prefer the shared `PluginLogger` to console output. Preserve the original failure signal and log only enough structured context to diagnose ownership or lifecycle divergence.

## Validation routes

For a focused behavior change:

1. Run the nearest regression test.
2. Run `npm run typecheck` and `npm run lint`.
3. Run `npm run check:boundaries` if imports, ports, packages, settings keys, localization, or tracked specs changed.
4. Run the broader affected Jest directory or full `npm run test`.
5. Build and inspect in Obsidian for user-visible UI/runtime work.

Before pushing, the CI-equivalent local route is:

```bash
npm run check:dependencies && \
npm run typecheck && \
npm run lint && \
npm run check:boundaries && \
npm run test:coverage && \
npm run build && \
npm run check:bundle-size
```

CI runs the full quality gates on Ubuntu and focused `test:platform-security` jobs on macOS and Windows. Pull requests also build production metafiles from their exact base and head, then append a non-blocking bundle report to the job summary. Release publication is a maintainer-pushed annotated tag (`x.y.z`, no leading `v`) after a `chore(release): prepare x.y.z` commit that already contains the matching `CHANGELOG.md` section and synced Obsidian metadata; the tag workflow then runs the same shared quality-gate action (dependency audit, typecheck, lint, boundaries, coverage, build, bundle-size) before uploading assets. See [Roadmap, release, and maintenance](10-roadmap-release-and-maintenance.md). Third-party Actions in privileged workflows are pinned to full commit SHAs; Dependabot covers `github-actions` updates. Do not explain away an unexpected failure or weaken a test to make a behavior change pass.

Before bumping `@earendil-works/pi-*`, keep the three packages on one exact version, update every `upstreamVersion` in `packages/engine-pi/compatibility-manifest.json`, run `npm run test:pi-compat`, and keep both Pi checks green. The manifest records why each upstream-shape-dependent adaptation exists, its tests, its removal condition, and issue [#113](https://github.com/shuuul/obsidian-pivi/issues/113). A weekly informational canary tests the newest synchronized stable Pi release in an ephemeral runner and updates one marker-backed comment on that issue; it never changes the repository or replaces review of an actual dependency bump. Private SessionManager access is asserted through one adapter and must fail with an actionable error before session mutation when a capability is missing.

## Bundle and CSS analysis

`npm run analyze:bundle` writes `metafile.json` from the same shared build options used for production. PR CI uses `--project` and `--output` to compare the exact base/head checkouts and reports total delta, the 20 largest current inputs with their deltas, and the embedded Skills CLI gzip bytes. Growth above 100 KiB or 2% produces a review warning without failing CI; `npm run check:bundle-size` independently enforces the 5 MiB hard ceiling. Compare measured inputs and `bytesInOutput` before making bundle-size claims. Keep benchmark/build conditions and dependency versions in the conclusion.

`npm run build:css` concatenates the explicit style manifest and validates missing imports and forbidden declarations. Do not rely on component import order or `!important` to fix ownership conflicts.

## Documentation-only changes

For pure Markdown changes, verify relative links and referenced paths/commands against the tree, run `git diff --check`, then run `npm run lint` and `npm run check:boundaries`. A production build and Obsidian reload are unnecessary unless documentation generation or shipped artifacts changed.
