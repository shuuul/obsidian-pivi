# Code Quality Review — pivi

> **Current snapshot:** 2026-06-24  
> **Scope:** Repository docs/config/source scan plus `npm run test:coverage -- --runInBand`.  
> **Relationship to older audit:** The 2026-05-25 audit has largely been remediated; completed and deferred items are tracked in [`notes/quality-backlog.md`](notes/quality-backlog.md), with bundle details in [`notes/bundle-analysis.md`](notes/bundle-analysis.md).

---

## Executive summary

The original quality review was no longer safe to read as current truth. Most structural issues it called out have been fixed: Obsidian tools are split, settings UI is modularized, CSS is minified, lint now warns on `any` / console / complexity / file length, bundle size has dropped, and test coverage has more than doubled.

The remaining risks are now concentrated in **large UI/controller surfaces**, **runtime callback seam clarity**, **MCP/OAuth unhappy paths**, and **low coverage for DOM-heavy rendering/settings code**.

## Current metrics

| Metric | Current value |
|--------|---------------|
| Unit test suites | 60 passed |
| Unit tests | 271 passed |
| Coverage — lines | 20.31% |
| Coverage — functions | 16.98% |
| Coverage — branches | 11.94% |
| Source/style files (`src/**/*.ts`, `src/**/*.css`) | 303 |
| Test files (`tests/**/*.test.ts`) | 60 |
| CSS `!important` occurrences | 19 |
| Bare swallowed async catches found by scan | 7 |
| Bundle size | ~4.5–4.6 MB after dedupe/provider pruning; see [`notes/bundle-analysis.md`](notes/bundle-analysis.md) |

Verification command:

```bash
npm run test:coverage -- --runInBand
```

---

## What has been fixed since the 2026-05-25 audit

| Area | Current state |
|------|---------------|
| Type/lint guardrails | `@typescript-eslint/no-explicit-any` is `warn`; `no-console` warns except `warn` / `error`; complexity and max-lines warn. |
| Obsidian tools | `createObsidianTools.ts` is now a small registry; per-tool factories live under `src/pi/tools/obsidian/`. |
| Settings UI | `PiModelsSettingsSection.ts` is now a re-export over `src/pi/ui/models-settings/` modules. |
| Shared helpers | `textResult`, `createLegacySseTransport`, `extractTextContent`, and model-key resolution helpers exist. |
| CSS | Production CSS minification exists in `scripts/build-css.mjs`; shared dropdown CSS exists; inline-edit `!important` count is reduced. |
| Tests | Coverage rose from ~10.6% statements / 6.9% branches to 20.31% lines / 11.94% branches; total tests rose from 118 to 271. |
| Bundle | Nested Pi dependency dedupe and provider selection reduced the original ~6.5 MB bundle to roughly ~4.5 MB. |
| Docs workflow | Durable quality follow-up belongs in this review, notes, specs, or architecture docs. |

For the detailed historical resolution table, keep using [`notes/quality-backlog.md`](notes/quality-backlog.md).

---

## Current high-value issues

### 1. Coverage is better but still weak around user-facing UI

Coverage is now meaningfully better, but the uncovered code is still where regressions are most visible: chat controllers, renderers, settings modals, MCP UI, and tab lifecycle.

| Area | Current signal |
|------|----------------|
| `src/features/chat/controllers/` | ~9% line coverage overall; `InputController`, `SessionController`, `StreamController` remain large and mostly untested. |
| `src/features/chat/rendering/` | ~9% line coverage overall; tool/subagent/ask-user rendering has low coverage. |
| `src/features/chat/tabs/` | ~13% line coverage overall; `TabManager` is still very low. |
| `src/features/settings/ui/` | ~3% line coverage overall; MCP settings/auth modals are thinly covered. |
| `src/pi/mcp/oauth/` | ~17% line coverage; auth callback and token failure paths need tests. |

Recommended next tests:

1. Focused `TabManager` restore/fork/delete tests around `sessionFile` + `leafId`.
2. `SessionController` branch picker behavior for current/open/closed leaves.
3. MCP OAuth failure/retry/token-corruption tests.
4. Renderer smoke tests for stored tool calls, subagents, ask-user blocks, and plan approval.

### 2. Large controller/UI classes remain hard to review

The worst monoliths changed, but several core UX files remain large enough that regressions hide easily:

| File | Current size | Concern |
|------|--------------|---------|
| `src/features/chat/controllers/InputController.ts` | ~1,321 lines | submission, queueing, context, shortcut, and runtime concerns are still dense. |
| `src/features/chat/controllers/StreamController.ts` | ~1,514 lines | many stream event responsibilities plus tool/subagent UI state. |
| `src/features/chat/services/SubagentManager.ts` | ~1,108 lines | improved coverage exists, but orchestration remains high-risk. |
| `src/features/chat/ui/InputToolbar.ts` | ~1,177 lines | model/mode/context/MCP/permission controls in one module. |
| `src/main.ts` | ~873 lines | composition root plus persistence/lifecycle glue. |

This does **not** require a broad refactor by default. Prefer extracting only when adding tests or changing behavior in the affected region.

### 3. Runtime contract should stay narrow

`ChatRuntime` is a Pi-backed chat lifecycle contract. Future additions should be tied to behavior that `PiChatRuntime` actually implements; avoid reintroducing placeholder callbacks or generic runtime capability flags.

### 4. Silent catches are much reduced, but a few remain

Current scan found remaining swallowed catches mostly in cleanup/fire-and-forget paths:

| File | Pattern |
|------|---------|
| `src/pi/mcp/oauth/McpAuthFlow.ts` | `transport.close().catch(() => {})` during cleanup |
| `src/features/chat/controllers/InputController.ts` | queued `sendMessage().catch(() => {})` |
| `src/features/chat/tabs/tabControllerInit.ts` | autosave `save(false).catch(() => {})` |
| `src/features/chat/tabs/TabManager.ts` | cleanup `deleteSession(...).catch(() => {})` |

These are no longer broad data-loss hotspots like the original audit, but they should carry comments or low-noise `console.warn` where user state could be affected.

### 5. Bundle size is improved but still worth watching

The bundle is no longer the original ~6.5 MB problem, but ~4.5 MB is still large for an Obsidian plugin. Current guidance in [`notes/bundle-analysis.md`](notes/bundle-analysis.md) is still valid: re-run `npm run analyze:bundle` after Pi/provider changes, and avoid adding always-imported provider/tool SDKs unless they are part of the supported provider set.

### 6. CSS pressure is lower, not gone

CSS `!important` usage is down to 19 occurrences. Remaining use may be justified by Obsidian/Electron style constraints, but new CSS should avoid increasing this number. Prefer shared tokens and existing component primitives over section-local overrides.

---

## Current prioritized action items

### P0 — Keep CI quality gates stable

| Action | Why |
|--------|-----|
| Keep `npm run typecheck && npm run lint && npm run test:coverage && npm run build` green before releases. | The codebase now relies on lint warnings and broad Jest coverage as regression tripwires. |
| Treat new `any`, `console`, complexity, and max-lines warnings as review blockers unless justified. | The lint rules are warnings, so discipline must happen in review. |
| Update this file or `notes/quality-backlog.md` when a major quality item is resolved or deliberately deferred. | Prevents another stale audit snapshot. |

### P1 — Highest ROI quality work

| Action | Target |
|--------|--------|
| Add focused tests for tab/session lifecycle. | `TabManager`, `SessionController`, `tabRuntime`, `tabFork` |
| Add MCP OAuth unhappy-path tests. | `src/pi/mcp/oauth/`, `McpVaultAuthStore`, settings auth UI boundaries |
| Narrow no-op runtime callbacks during Pi-only simplification. | `ChatRuntime`, `PiChatRuntime`, `tabServiceCallbacks.ts` |
| Add renderer smoke tests for stored history. | tool calls, subagents, ask-user, plan approval, write/edit blocks |

### P2 — Opportunistic cleanup during feature work

| Action | Target |
|--------|--------|
| Extract small, behavior-named helpers from large controllers only when touching that flow. | `InputController`, `StreamController`, `InputToolbar` |
| Add comments/logging for remaining swallowed cleanup catches. | OAuth cleanup, autosave/delete fire-and-forget paths |
| Re-run bundle analysis after dependency or provider changes. | `npm run analyze:bundle` |
| Continue reducing `!important` when editing nearby CSS. | `src/style/**` |

---

## Watch list

These are not current blockers, but they are good review prompts:

- **Prompt/MCP regression harness:** already captured in [`specs/turn-prompt-spec.md`](specs/turn-prompt-spec.md) and [`specs/mcp-integration-spec.md`](specs/mcp-integration-spec.md).
- **Session branch export/share:** captured as future work in [`specs/session-tree-spec.md`](specs/session-tree-spec.md).
- **pi-ai credential ownership migration:** tracked in [`notes/pi-ai-credential-management.md`](notes/pi-ai-credential-management.md).
- **Stable notes promotion:** the docs workflow now says durable notes should be promoted into architecture/spec docs.

---

## Verification notes

Latest verification run:

```text
npm run test:coverage -- --runInBand
Test Suites: 60 passed, 60 total
Tests:       271 passed, 271 total
Coverage:    20.31% lines, 16.98% functions, 11.94% branches
```

No source code was changed for this review update.
