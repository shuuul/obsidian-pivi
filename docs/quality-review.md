# Code Quality Review — obsius2

> ⚠️ **Historical snapshot (2026-05-25).** Many findings from this audit have been resolved. See [`notes/quality-backlog.md`](notes/quality-backlog.md) for the current remediation tracking and [`notes/bundle-analysis.md`](notes/bundle-analysis.md) for up-to-date bundle metrics.

> **Status:** Remediation tracked in [`notes/quality-backlog.md`](notes/quality-backlog.md) (2026-05-25 pass).

> **Date:** 2026-05-25
> **Scope:** Full codebase scan via 5 parallel Explore subagents
> **Files analyzed:** ~220 source files, 42,010 lines; 34 test files, 2,741 lines; 22 CSS files

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Source files | ~220 |
| Source lines | 42,010 |
| Test files | 56 |
| Test lines | 3,985 |
| Test-to-source ratio | 6.5% (lines) |
| Statement coverage | 10.6% |
| Branch coverage | 6.9% |
| Total tests | 118 |
| Zero-vulnerability audit | ✅ clean |
| Bundle size (main.js) | 4.6 MB (after dedupe) |
| Test runtime | ~4.6s |

### Top 10 Most Impactful Findings

1. **Critical:** `@typescript-eslint/no-explicit-any` is disabled globally (`off`), allowing ~30+ `any` escapes
2. **Critical:** `src/main.ts` (809 lines) has 0% test coverage — highest-risk untested code
3. **Critical:** 10+ silent `catch {}` blocks across the codebase swallow errors with zero logging
4. **High:** `createObsidianTools.ts` is a 447-line monolithic function with 16 `as` type assertions
5. **High:** CSS `!important` abuse (33+ occurrences, 18 in `inline-edit.css` alone)
6. **High:** `JSON.parse` without `try/catch` in settings load (`ObsiusSettingsStorage.ts:119`)
7. **High:** 6 callback setters in `PiChatRuntime` are no-ops with no wiring
8. **Medium:** No CSS minification in production build
9. **Medium:** 6+ dead exports in `core/tools/toolNames.ts` (`isMcpTool`, `isBashTool`, etc.)
10. **Medium:** CSS duplication between `history.css` and `resume-session.css`

---

## 1. Type Safety — `any` & Loose Types

### 1.1 Global `no-explicit-any: off`

**Config:** `eslint.config.mjs:88`
**Recommendation:** Enable at `warn` level immediately.

This single rule being disabled is the root cause of most type-safety erosion. With TS 6.0, this is especially impactful.

### 1.2 Hotspots

| File | Line(s) | Pattern | Risk |
|------|---------|---------|------|
| `src/pi/ui/PiChatUIConfig.ts` | 27, 31, 35, 107 | `Map<string, any>`, `piAi as any`, `let fallbackModel: any` | High |
| `src/pi/runtime/PiChatRuntime.ts` | 238 | `messages as any[]` in `convertToLlm` | High — entire message pipeline loses type safety |
| `src/pi/runtime/PiAuxQueryRunner.ts` | 92 | `as never[]` on messages | High |
| `src/pi/runtime/PiAgentEventAdapter.ts` | 66–67 | `event.message as unknown as Record<string, unknown>` | Medium |
| `src/pi/ui/piThinkingLevels.ts` | 33 | `as PiResolvedModel` from `any` cache | Medium |
| `src/main.ts` | 394, 448 | `settings as unknown as Record<string, unknown>` (5× total) | Medium |
| `src/app/settings/ObsiusSettingsStorage.ts` | 141 | `merged as unknown as Record<string, unknown>` | Medium |

### 1.3 Pervasive Pattern: `Record<string, unknown>` Bypass

The idiom `const bag = value as unknown as Record<string, unknown>; bag.someField` appears in **10+ locations** across the codebase. This completely bypasses compile-time checking.

**Files affected:**
`main.ts`, `ObsiusSettingsStorage.ts`, `PiModelsSettingsSection.ts`, `buildAgentToolRegistry.ts`, `toolInput.ts`, `PiMcpConnectionPool.ts`, `McpTester.ts`, `PiChatUIConfig.ts`, `SessionTreeStore.ts`, `PiSessionStore.ts`

---

## 2. Error Handling

### 2.1 Silent `catch {}` Blocks

| File | Line(s) | Context | Severity |
|------|---------|---------|----------|
| `src/core/mcp/McpTester.ts` | 97, 120 | Tool listing / close failure | High |
| `src/pi/mcp/PiMcpConnectionPool.ts` | 167–168, 210 | Close errors + tool listing | High |
| `src/pi/mcp/PiMcpBridge.ts` | 99 | Tool cache fetch failure | High |
| `src/pi/runtime/PiChatRuntime.ts` | 294–296 | `syncAgentMessages()` in `agent_end` | **Critical** — session history silently lost |
| `src/pi/runtime/PiChatRuntime.ts` | 311–313 | `appendUserMessage()` failure | High — user message silently dropped |
| `src/pi/runtime/PiChatRuntime.ts` | 555–559 | `setReady` listener errors | Medium |
| `src/app/storage/SharedStorageService.ts` | 42–44, 55–57 | Tab layout save/load failure | High |
| `src/core/tools/toolInput.ts` | 70 | JSON parse failure | Medium |
| `src/main.ts` | 517–519, 529–531 | Tab restart failure (counts but no log) | Medium |

### 2.2 Low/No Logging

Most catch blocks use `catch {}` or `.catch(() => {})` with **zero logging** — not even `console.warn`. When issues surface, `console.warn` in caught errors is acceptable per the project's own guidelines (which only ban `console.log`).

### 2.3 `JSON.parse` Without `try/catch`

| File | Line | Risk |
|------|------|------|
| `src/app/settings/ObsiusSettingsStorage.ts` | 119 | Settings corruption → full settings tab failure |
| `src/pi/auth/ProviderOAuthService.ts` | 71 | OAuth token corruption → auth failure |

---

## 3. Code Structure & Complexity

### 3.1 Oversized Functions

| File | Function / Class | Lines | Problems |
|------|-----------------|-------|----------|
| `src/pi/tools/createObsidianTools.ts` | `createObsidianTools()` | 447 | Monolithic, 16 `as` assertions, 7+ repetitive arg-building blocks |
| `src/pi/ui/PiModelsSettingsSection.ts` | `renderPiModelsSettingsSection()` | 546 | Single function for entire provider settings UI |
| `src/features/chat/controllers/InputController.ts` | `sendMessage()` | 387 | 7 distinct zones of responsibility |
| `src/features/chat/controllers/StreamController.ts` | `handleStreamChunk()` | 122 | Giant switch, hides 3 duplicated render queues (~200 lines each) |
| `src/pi/runtime/PiChatRuntime.ts` | class | 610 | 15 private methods, 30+ instance fields, no extraction |
| `src/features/chat/services/SubagentManager.ts` | class | 1,107 | No tests, 0% coverage |
| `src/main.ts` | `ObsiusPlugin` class | 809 | Plugin + settings + session CRUD + env vars — mixed concerns |

### 3.2 Repetitive Patterns

- **`textResult()` helper** defined in 3 tool files with slightly different signatures (`createObsidianTools.ts`, `createSkillTool.ts`, `createSubagentTool.ts`)
- **`createLegacySseTransport` + URL types** duplicated in `McpTester.ts` and `PiMcpConnectionPool.ts`
- **Render queue pipelines** (3 copies, ~200 lines each) in `StreamController.ts`
- **`.filter(type==='text').map(t=>t.text).join('')`** repeated in `PiAgentEventAdapter.ts:34–37,45–49`

### 3.3 Dead / Unused Code

| File | Symbol | Status |
|------|--------|--------|
| `src/core/tools/toolNames.ts:53–65` | `isSubagentSpawnTool`, `isSubagentHiddenTool`, `SUBAGENT_HIDDEN_TOOLS` | Exported, 0 callers |
| `src/core/tools/toolNames.ts:135–148` | `isMcpTool`, `isBashTool`, `isFileTool`, `isReadOnlyTool` + backing arrays | Exported, 0 callers |
| `src/core/tools/toolInput.ts:100` | `getPathFromToolInput()` | Exported, 0 callers |
| `src/core/agent/agentEnvironment.ts:248` | `getRuntimeEnvironmentVariables()` | Exported, 0 callers |
| `src/pi/runtime/PiChatRuntime.ts:152` | `setResumeCheckpoint()` | No-op |
| `src/pi/runtime/PiChatRuntime.ts:394–399` | 6 callback setters (`setApprovalDismisser`, etc.) | All no-ops |
| `src/features/chat/file-context/state/FileContextState.ts:41` | `setAttachedFiles()` | Defined, never called |

### 3.4 No-op Callbacks

`PiChatRuntime` accepts but discards 6 callbacks:

```typescript
setApprovalDismisser(_callback: ApprovalDismisser | null): void {}
setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
setPermissionModeSyncCallback(_callback: ((mode: string) => void) | null): void {}
setSubagentHookState(_getState: () => SubagentRuntimeState): void {}
setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}
```

---

## 4. CSS Quality

### 4.1 `!important` Breakdown

| File | Count |
|------|-------|
| `src/style/features/inline-edit.css` | 18 |
| `src/style/components/input.css` | 10 |
| `src/style/base/container.css` | 3 |
| `src/style/features/plan-mode.css` | 1 |
| `src/style/components/toolcalls.css` | 1 |
| `src/style/settings/base.css` | 1 |
| **Total** | **33+** |

The `inline-edit.css` file uses `!important` on almost every property — this suggests insufficient selector specificity or fighting Obsidian's base styles repeatedly.

### 4.2 Duplication: `history.css` ↔ `resume-session.css`

Both implement a "dropdown list" pattern with near-identical CSS:

| `history.css` | `resume-session.css` |
|---|---|
| `.obsius2-history-menu` | `.obsius2-resume-dropdown` |
| `.obsius2-history-header` | `.obsius2-resume-header` |
| `.obsius2-history-item` | `.obsius2-resume-item` |
| `.obsius2-history-item-icon` | `.obsius2-resume-item-icon` |
| `.obsius2-history-item-content` | `.obsius2-resume-item-content` |
| `.obsius2-history-item-title` | `.obsius2-resume-item-title` |
| `.obsius2-history-item-date` | `.obsius2-resume-item-date` |
| `.obsius2-history-empty` | `.obsius2-resume-empty` |

### 4.3 Other CSS Issues

- **`-webkit-backdrop-filter` without `backdrop-filter` fallback** — 4 files
- **No `@media` or `@supports` queries** — zero responsive handling
- **Hardcoded pixel values** — 59 `px` instances in `input.css` alone
- **No CSS sourcemaps** in production build
- **`base.css` at 627 lines** — largest CSS file, could be split
- **`.obsius2-tool-label` legacy comment** — marked as "legacy: StatusPanel still uses this" — verify if dead

---

## 5. Build & Config

### 5.1 CSS Build Pipeline

The CSS build is a **completely separate Node script** (`scripts/build-css.mjs`), not integrated with esbuild:

- No CSS bundling/optimization via esbuild
- No CSS minification in production
- No vendor prefix auto-adding
- No CSS sourcemaps

### 5.2 Mismatch: `tsconfig.json` vs `esbuild.config.mjs`

| Config | Setting |
|--------|---------|
| `tsconfig.json` | `"lib": ["DOM", "ES2022"]` |
| `esbuild.config.mjs` | `target: 'es2018'` |

TypeScript allows ES2022 syntax but esbuild transpiles to ES2018. Works but confusing.

### 5.3 Bundle Size: 6.5 MB

Very large for an Obsidian plugin (typical: 200KB–2MB). Likely `pi-agent-core` / `pi-ai` external packages. `treeShaking: true` is enabled but may be ineffective due to side-effect flags.

### 5.4 Post-build Regex Rewrite

`esbuild.config.mjs:63–73` applies `rewriteDynamicNodeImports()` via regex replacement on `main.js` after build — fragile and could silently break with minification.

---

## 6. Dependency Health

| Status | Detail |
|--------|--------|
| **Zero vulnerabilities** | ✅ 969 total deps (326 prod, 633 dev, 67 optional) |
| **Outdated** | `eslint-plugin-simple-import-sort` 12.1.1 → 13.0.0 |
| **Potentially unused** | `jest-environment-jsdom` (2.7 MB, test env is `node`), `tslib`, `tsx` |
| **All packages current** | TS 6.0, Jest 30, ESLint 10, esbuild 0.28 |

---

## 7. Hexagonal Architecture Compliance

**Status: ✅ Clean**

- `src/features/` imports only from `src/core/` (abstract ports) — never from `src/pi/`
- `src/app/`, `src/shared/`, `src/utils/` follow the same rule
- Wiring of Pi adaptor happens only in `main.ts` (bootstrap) and `src/app/settings/`
- The lint config enforces `src/core/` cannot import `@/features`

**One minor concern:** `buildAgentToolRegistry.ts` and `createSubagentTool.ts` import `ObsiusPlugin` from `../../main` — tight coupling to the concrete plugin class, potential circular dependency risk.

---

## 8. Test Coverage

### 8.1 Coverage by Area

| Directory | Files | Coverage (approx) |
|-----------|-------|-------------------|
| `src/core/agent/` | 8 | 25% stmts |
| `src/core/mcp/` | 3 | 16.5% stmts |
| `src/core/security/` | 1 | 7.5% stmts |
| `src/pi/` | 50 | ~20% est. |
| `src/features/chat/` | 69 | < 5% est. |
| `src/utils/` | 27 | ~0% |
| `src/app/` | 3 | ~0% |
| `src/core/tools/` | 7 | ~0% |
| `src/i18n/` | 3 | 0% |

### 8.2 Untested Critical Files

| File | Lines | Coverage |
|------|-------|----------|
| `src/main.ts` | 809 | 0% |
| `src/features/chat/state/ChatState.ts` | 436 | 0% |
| `src/features/chat/services/SubagentManager.ts` | 1,107 | 0% |
| `src/pi/tools/createObsidianTools.ts` | 447 | 0% |
| `src/utils/diff.ts` | 302 | 3.97% |
| `src/utils/session.ts` | 240 | 0% |
| `src/utils/fileLink.ts` | 263 | 0% |
| `src/utils/frontmatter.ts` | 194 | 0% |
| `src/utils/env.ts` | 297 | 15.69% |

### 8.3 Missing Test Categories

- **Error paths** — network failures, API errors, file not found (only 2 test files cover async errors)
- **Edge cases** — empty/null/unicode/large inputs
- **Async / race conditions** — concurrent streams, queue ordering
- **State mutation** — ChatState transitions, CRUD, tab lifecycle
- **UI rendering** — 12+ rendering files untested
- **MCP lifecycle** — server start/stop, config parsing, connection pool
- **Plugin lifecycle** — `main.ts` onload/onunload entirely untested

### 8.4 Test Quality Issues

- **Thin tests** — `streamToolUseRouting.test.ts` tests string-to-string mappings, not behavior
- **No shared fixtures** — 8+ inline factory functions duplicated across test files
- **`as never` overuse** — at least 7 test files bypass type safety with `as never`
- **Module-level mutable state** — `mockAgentInstances` global array in `PiChatRuntime.systemPrompt.test.ts`
- **Obsidian mock is shallow** — `vault.read`, `vault.create`, `metadataCache` methods missing

---

## 9. Prioritized Action Items

### 🔴 P0 — Fix Immediately

| # | Action | Location(s) |
|---|--------|-------------|
| 1 | Enable `no-explicit-any` as `warn` | `eslint.config.mjs:88` |
| 2 | Add logging to all bare `catch {}` blocks | 10+ locations across runtime, MCP, storage |
| 3 | Add `try/catch` around `JSON.parse` in settings load | `ObsiusSettingsStorage.ts:119`, `ProviderOAuthService.ts:71` |
| 4 | Remove 6 dead type guard functions | `src/core/tools/toolNames.ts:53–65,135–148` |
| 5 | Remove dead `getPathFromToolInput` | `src/core/tools/toolInput.ts:100` |

### 🟠 P1 — Next Sprint

| # | Action | Location(s) |
|---|--------|-------------|
| 6 | Add tests for `src/main.ts` | Critical, 0% coverage |
| 7 | Add tests for `ChatState.ts`, `SubagentManager.ts` | Core state + orchestration, 0% |
| 8 | Add tests for `diff.ts`, `session.ts`, `fileLink.ts`, `frontmatter.ts` | 0–4% coverage |
| 9 | Extract shared `textResult()` helper | 3 tool files |
| 10 | Deduplicate `createLegacySseTransport` | `McpTester.ts`, `PiMcpConnectionPool.ts` |
| 11 | Extract shared `extractTextContent()` helper | `PiAgentEventAdapter.ts` |
| 12 | Deduplicate model resolution (`key.indexOf('/')` + `piAi.getModel`) | `piModelEnv.ts`, `piThinkingLevels.ts` |
| 13 | Add `no-console` eslint rule | `eslint.config.mjs` |

### 🟡 P2 — Medium Term

| # | Action | Location(s) |
|---|--------|-------------|
| 14 | Refactor `createObsidianTools.ts` (447 lines → per-tool factories) | `src/pi/tools/createObsidianTools.ts` |
| 15 | Refactor `PiModelsSettingsSection.ts` (546 lines → 5–6 components) | `src/pi/ui/PiModelsSettingsSection.ts` |
| 16 | Split `history.css` / `resume-session.css` into shared dropdown component | `src/style/` |
| 17 | Reduce `!important` usage in `inline-edit.css` (18 → 0) | `src/style/features/inline-edit.css` |
| 18 | Integrate CSS pipeline with esbuild (minification, sourcemaps, prefixing) | `esbuild.config.mjs`, `build-css.mjs` |
| 19 | Remove unused `jest-environment-jsdom` (saves 2.7 MB) | `package.json` |
| 20 | Replace `void electron.shell.openExternal(url)` with error handling | `src/pi/mcp/oauth/openAuthUrl.ts` |
| 21 | Investigate 6.5 MB bundle size | `esbuild.config.mjs` |
| 22 | Create shared test factories/fixtures | `tests/helpers/` |
| 23 | Add complexity/max-lines eslint rules | `eslint.config.mjs` |
| 24 | Add error-path tests across existing test files | All test suites |

### 🟢 P3 — Nice to Have

| # | Action | Location(s) |
|---|--------|-------------|
| 25 | Build output to `dist/` instead of project root | `esbuild.config.mjs` |
| 26 | CSS custom property system for spacing (`--obsius2-spacing-*`) | All CSS files |
| 27 | Consistent CSS section comment convention | All CSS files |
| 28 | Add `backdrop-filter` fallback (non-webkit) | 4 CSS files |
| 29 | Extract `SessionManager` / `ToolRegistryManager` from `PiChatRuntime` | `src/pi/runtime/PiChatRuntime.ts` |
| 30 | Replace `window.setTimeout` with `setTimeout` import (Node.js compat) | `McpTester.ts`, `ObsidianCliTransport.ts` |
| 31 | DTO validation (Zod or lighter validator) for tool input shapes | `createObsidianTools.ts` + all tool files |
| 32 | Consolidate `bootstrapPiAgent()` calls in tests | 4 test files |
| 33 | Add test timeouts | `jest.config.js` |
| 34 | Remove legacy `.obsius2-tool-label` CSS if dead | `toolcalls.css` |
| 35 | Replace `innerHTML` for static SVGs with `setIcon()` or DOM API | `PiSkillsSettingsSection.ts` |

---

## 10. Agent-by-Agent Breakdown

### Agent 1: Pi Runtime & Agent Core
- **Files:** `src/pi/runtime/`, `src/core/agent/`, `src/agent/`, `src/pi/services.ts`, `src/pi/session/`
- **Key findings:** 6 no-op callbacks, silent catch blocks in `PiChatRuntime.ts`, model resolution duplication across `piModelEnv.ts` / `piThinkingLevels.ts`
- **Coverage:** ~20% for pi runtime, ~25% for core agent

### Agent 2: Chat UI & Features
- **Files:** `src/features/chat/`, `src/features/inline-edit/`
- **Key findings:** No `any` escapes in features (excellent!), 3× duplicated render queue in `StreamController.ts`, `sendMessage()` at 387 lines, dead `setAttachedFiles()`
- **Clean architecture:** ✅ No hexagonal violations

### Agent 3: MCP, Tools & Agent System
- **Files:** `src/core/mcp/`, `src/pi/mcp/`, `src/pi/tools/`, `src/core/tools/`, `src/core/settings/`
- **Key findings:** 6 dead type guard functions, `createLegacySseTransport` duplicated, `textResult()` triplicated, `createObsidianTools.ts` 447-line monolith with 16 `as` assertions
- **Error handling:** Silent catch blocks in all 3 MCP files

### Agent 4: App, Settings & Style
- **Files:** `src/app/`, `src/settings.ts`, `src/main.ts`, `src/pi/ui/`, `src/style/`, config files
- **Key findings:** `no-explicit-any: off` globally, CSS `!important` abuse (33×), 5× `as unknown as Record<string, unknown>`, 546-line settings render function, CSS history/resume-session duplication
- **Security:** No suspicious patterns, keychain storage correct

### Agent 5: Tests & Build
- **Files:** `tests/`, config files, package.json
- **Key findings:** 10.6% statement coverage, 0% for `main.ts` / `ChatState.ts` / `SubagentManager.ts` / `createObsidianTools.ts`, bundle size 6.5 MB, no CSS pipeline integration, 8+ inline factory functions, `as never` overuse
- **Dependency health:** Zero vulns, all packages current

---

## Appendix: Quick Stats by Directory

| Directory | Files | Lines | Test Coverage | Key Concern |
|-----------|-------|-------|---------------|-------------|
| `src/core/agent/` | 8 | ~1,500 | ~25% | Dead exports, no-ops |
| `src/core/mcp/` | 3 | ~400 | ~16.5% | Silent catches |
| `src/core/tools/` | 7 | ~150 | ~0% | 6 dead exports |
| `src/core/settings/` | 2 | ~300 | partial | — |
| `src/core/types/` | 5 | ~600 | N/A (types) | `unknown` leakage |
| `src/features/chat/` | 69 | ~12,000 | < 5% | Largest untested area |
| `src/features/inline-edit/` | 5 | ~500 | 0% | No tests at all |
| `src/pi/runtime/` | 11 | ~1,500 | ~20% | Silent catches, any casts |
| `src/pi/mcp/` | 6 | ~400 | partial | Silent catches |
| `src/pi/tools/` | 7 | ~1,000 | ~0% | 447-line monolith |
| `src/pi/ui/` | 10 | ~1,200 | ~0% | `any` escapes, 546-line render |
| `src/app/` | 3 | ~300 | ~0% | JSON.parse unchecked |
| `src/utils/` | 27 | ~3,000 | ~0% | Largest untested utility layer |
| `src/style/` | 22 | ~3,500 | N/A | `!important`, no build pipeline |
| `tests/` | 34 | 2,741 | N/A | Thin tests, lacking error paths |
