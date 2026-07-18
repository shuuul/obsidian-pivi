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
| Architecture/package/i18n/spec guards | `npm run check:boundaries` |
| All Jest projects | `npm run test` |
| Coverage and thresholds | `npm run test:coverage` |
| Production bundle and deploy | `npm run build` |
| Bundle inspection metadata | `npm run analyze:bundle` |
| Bundle-size ceiling | `npm run check:bundle-size` |
| Privacy-safe session diagnostics | `npm run audit:sessions -- <vault-or-sessions-dir>` |

Always run Jest through the npm wrapper:

```bash
npm run test -- tests/unit/features/chat/inputTurnSubmission.test.ts
npm run test -- --runInBand tests/unit/pi/runtime/piBackgroundSubagentJobs.test.ts
npm run test -- -t "test name"
```

`scripts/run-jest.js` supplies the Node local-storage file and repository setup. Direct Jest invocation can produce misleading failures.

`audit:sessions` is read-only. It separates `perf-*` fixtures from real behavior and reports aggregate tool errors, Bash policy retries, malformed JSONL, oversized results/sessions, and message-UI overlay amplification. Add `--json` for machine-readable output. Reports intentionally omit user text, tool arguments, target entry IDs, and JSONL content; findings are diagnostic and do not cause a failing exit status.

## Feature test index

| Area | Starting points |
|---|---|
| Lifecycle/composition | `tests/unit/main/pluginLifecycle.test.ts`, `tests/unit/app/ui/imperativeChatAdapter.test.ts` |
| Input and queue | `tests/unit/features/chat/inputTurnSubmission.test.ts`, `inputStreamingQueue.test.ts`, `inputControllerLifecycle.test.ts` |
| Prompt layers | `tests/unit/pi/runtime/buildTurnPrompt.test.ts` |
| Tabs and restore | `tests/unit/features/chat/tabManagerLifecycle.test.ts`, `sessionControllerLifecycle.test.ts`, `sessionSwitch.test.ts` |
| External context privacy | `tests/unit/features/chat/tabExternalContext.test.ts`, `tests/unit/app/deviceLocalExternalContextStore.test.ts`, Pi session-store tests |
| Subagents | `tests/unit/pi/tools/createSubagentTool.test.ts`, `piBackgroundSubagentJobs.test.ts`, `subagentConcurrencyLimiter.test.ts` |
| React chat/settings | `tests/pivi-react/ChatShell.test.tsx`, `AssistantContentView.test.tsx`, `activityPresentation.test.ts`, `chatUiStore.test.tsx`, `SettingsUi.test.tsx`, `PiviSettingTabHost.test.ts` |
| Owner-realm DOM | `tests/pivi-react/OwnerRealmDom.test.ts`, `DefaultVaultSkillsPrompt.test.ts`, `tests/unit/app/ui/createStreamingMarkdownContentAdapter.test.ts` |
| Tools and MCP | Relevant suites under `tests/unit/engine/tools/`, `tests/unit/pi/tools/`, `tests/unit/pi/mcp/`, plus `tests/unit/pi/piMcpBridge.test.ts` and `tests/pivi-react/McpToolsSection.test.tsx` |

Use `rg --files tests | rg <feature>` to locate the current exact filename; test names move as ownership is refined.

## Debugging in Obsidian

For user-visible UI or runtime work:

```bash
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
```

Use a configured development vault. Verify the main window and a pop-out when changing element-bound DOM, timers, scrolling, portals, or tooltips. Include Hover Editor when changing view lifecycle. Test Source mode and Live Preview for editor integrations.

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
| MCP slash entry is stale | settings save/reload invalidation, remote-only prefetch, lazy stdio connection, catalog refresh |
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
npm run typecheck && \
npm run lint && \
npm run check:boundaries && \
npm run test:coverage && \
npm run build && \
npm run check:bundle-size
```

CI runs the same categories on pull requests and pushes to `main`. Do not explain away an unexpected failure or weaken a test to make a behavior change pass.

## Bundle and CSS analysis

`npm run analyze:bundle` writes `metafile.json` from the same shared build options used for production. Compare measured inputs and `bytesInOutput` before making bundle-size claims. Keep benchmark/build conditions and dependency versions in the conclusion.

`npm run build:css` concatenates the explicit style manifest and validates missing imports and forbidden declarations. Do not rely on component import order or `!important` to fix ownership conflicts.

## Documentation-only changes

For pure Markdown changes, verify relative links and referenced paths/commands against the tree, run `git diff --check`, then run `npm run lint` and `npm run check:boundaries`. A production build and Obsidian reload are unnecessary unless documentation generation or shipped artifacts changed.
