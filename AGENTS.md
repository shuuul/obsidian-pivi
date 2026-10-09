# Pivi Developer Guide

Welcome to the **Pivi** developer reference guide. This document is the **operational** entry point for build, test, lint, release, project glossary, quality gates, and repo-wide seam rules.

---

## 📚 Project guidance

Pivi keeps the new-developer architecture, technology rationale, end-to-end flows, and contribution routes in the [`docs/` handbook](docs/README.md). Durable operational guidance remains in layered `AGENTS.md` files: root guidance covers repo-wide build, test, release, and seam rules; package-local files cover package purpose, public entrypoints, boundaries, and verification notes.

For README architecture / workflow diagrams, prefer fenced Mermaid diagrams (` ```mermaid `) because GitHub renders them natively.

| Layer | Location | When to update |
|-------|----------|----------------|
| Developer handbook | `docs/README.md`, `docs/[0-9][0-9]-*.md` | User-visible behavior, end-to-end flows, public interfaces, persistence/configuration, boundaries, technology choices, development/release routes, or roadmap changes |
| Long-running specs | `specs/README.md`, `specs/NNN-*.md` | Multi-agent work breakdown, decisions, handoffs, verification, and completion tracking |
| Repo operations | `AGENTS.md` | Build/test/release/spec workflow changes |
| Package contracts | `packages/*/AGENTS.md` | Package entrypoints, dependency boundaries, or gotchas change |
| Feature maps | `src/ui/AGENTS.md`, `src/ui/chat/AGENTS.md`, `src/ui/chat/rendering/AGENTS.md`, `src/ui/shared/AGENTS.md`, `src/app/AGENTS.md`, `packages/pivi-react/AGENTS.md`, `packages/pivi-react/src/i18n/AGENTS.md`, `packages/pivi-react/styles/AGENTS.md`, `src/ui/chat/input/file-context/AGENTS.md`, `src/ui/chat/input/file-context/state/AGENTS.md`, `src/ui/chat/input/file-context/view/AGENTS.md` | Local UI/runtime flow or seam rules change |
| Glossary/overview | `AGENTS.md` | Project identity or canonical terminology changes |
| Releases | GitHub Releases / `CHANGELOG.md` | User-visible release history |

**Workflow**

1. Explore in Obsidian / Heptabase (optional).
2. For long-running or multi-agent work, create and index a tracked spec from [`specs/000-template.md`](specs/000-template.md) before delegating work. Keep its decisions, workstreams, verification, and handoffs current.
3. Implement in the owning package or app area.
4. Update the closest `AGENTS.md` whenever code invalidates its map, seam rules, terminology, or gotchas. Start with the directory you changed and walk upward until guidance remains accurate.
5. Update the relevant numbered developer document in the same change whenever code changes user-visible behavior, an end-to-end flow, a public interface/type, configuration or persistence, a package boundary, a technology choice, development/release commands, or roadmap status. Keep package-local operational invariants in the owning `AGENTS.md` and link to the handbook for narrative detail.
6. Before completing and archiving a spec, synchronize every durable conclusion into the relevant numbered docs and the nearest affected `AGENTS.md` files, walking upward until the guidance remains accurate.
7. Before committing, review the staged diff and confirm the active spec, handbook, and nearest `AGENTS.md` files still describe it. Behavior-preserving internal refactors and test-only changes do not require documentation churn unless they invalidate a path, command, map, or verification rule.
8. Do not open a pull request until the local CI-equivalent quality gates are green. GitHub Actions confirms that suite; it is not the first place to discover a failure. The command is in Quality gates below.
9. Write the matching `CHANGELOG.md` section in the release commit; keep README version changes in `node scripts/sync-version.js`.

For UI or runtime changes that the user needs to inspect inside Obsidian, run the project build and reload the plugin before handing back control. The normal path is `npm run build` followed by `obsidian plugin:reload id=pivi`, unless the user explicitly asks not to reload or the Obsidian CLI is unavailable.

**PR checklist** (include in description when applicable):

```markdown
Related guidance:
- Package: packages/<name>/AGENTS.md
- Local: <nearest>/AGENTS.md
```

| Change size | Documentation |
|-------------|----------------|
| Small fix | Code comment only when the why is non-obvious |
| Medium feature | Active spec when work is long-running/multi-agent; relevant numbered developer doc plus owning package/local `AGENTS.md` when its map or rules change |
| Architecture / framework | Active spec, developer handbook, root guidance, and affected package/local `AGENTS.md` |
| Stable module API | Relevant developer doc plus owning package `AGENTS.md` |
| User-visible UI text | Always `packages/pivi-react/src/i18n/` in the **same commit** (see Coding Standards) |

---

## 🤖 Agent skills

This repo does not track repo-local agent skills. Keep developer narrative in `docs/` and operational project guidance in this file and package/local `AGENTS.md` files; runtime vault skills live under each vault's `.pivi/skills/` directory.

**Vault default bundle** (end users, not this repo): first vault load may prompt to install [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) into `<vault>/.pivi/skills/`, but installation/updating must happen only after explicit user confirmation.

Do not add speculative skill placeholders. If a repo-local skill becomes necessary, add the implementation and matching lockfile entry intentionally, then update this section in the same change.

Nested `AGENTS.md` files under `src/`, `tests/`, and `packages/` are directory/package maps (`init-deep` or hand-maintained); treat root `AGENTS.md` as authoritative for cross-cutting rules. The hierarchy is:

- **Root** `AGENTS.md` — repo-wide build, test, release, seam rules, glossary, and quality gates.
- **Package** `packages/*/AGENTS.md` — package purpose, entrypoints, boundaries, verification. `packages/agent/AGENTS.md` covers host-neutral agent foundations; `packages/engine-pi/AGENTS.md` covers the Pi SDK adapter package.
- **App** `src/app/AGENTS.md` — composition shell, host contracts, runtime services.
- **UI** `src/ui/AGENTS.md` → `src/ui/chat/AGENTS.md` → `src/ui/chat/rendering/AGENTS.md`, `src/ui/chat/input/file-context/AGENTS.md` → `state/AGENTS.md` / `view/AGENTS.md`, `src/ui/shared/AGENTS.md` — app-side runtime and imperative adapter maps.
- **React UI** `packages/pivi-react/AGENTS.md` — presentation boundary, locale catalogs, styles, and React ownership rules.
- **i18n** `packages/pivi-react/src/i18n/AGENTS.md` — translator API, locale catalogs, translation commit policy.
- **Styles** `packages/pivi-react/styles/AGENTS.md` — CSS architecture, manifest order, build flow, conventions.
- **Tests** `tests/AGENTS.md` — Jest topology, commands, layout.
- **Scripts** `scripts/AGENTS.md` — build/test/version helper scripts.

---

## 🚀 Project Overview

**Pivi** (ID: `pivi`) is an Obsidian community plugin that embeds the **Pi agent** (`@earendil-works/pi-agent-core`) as its sole agent runtime inside an Obsidian sidebar view.

**Minimum Obsidian:** `1.13.0` (declarative settings pages; provider API keys use `app.secretStorage` / keychain).

### Architecture summary

- **Design premise**: Pivi targets the Pi runtime and Obsidian only. Running on another agent runtime or embedding in another host is not a goal. The package split exists for two reasons: unit tests run package logic against injected fakes instead of Obsidian or the Pi SDK, and Pi SDK churn stays inside `@pivi/engine-pi` and `packages/agent/src/mcp`. Do not add an abstraction whose only justification is portability.
- **Packages**: `@pivi/agent` (agent logic with no Obsidian or Pi SDK imports), `@pivi/engine-pi` (the only Pi SDK adapter), `@pivi/obsidian-host` (vault, storage, network, and process adapters), `@pivi/obsidian-tools` (Obsidian-backed tools), `@pivi/pivi-react` (React presentation, i18n, and CSS). `src/main.ts` is a lifecycle-only shell, `src/app` composes everything, and `src/ui` holds chat orchestration and imperative adapters.
- **Dependency direction**: only `src/app` and `src/main.ts` import `@pivi/engine-pi`. Host and tools never import UI or the engine. `src/ui` reaches React only through the `store` and `context-badges` subpaths and reaches runtime behavior only through injected `ChatPorts`. `npm run check:architecture` is the single enforcement point.
- **Storage**: sessions are JSONL under `.pivi/sessions/`; synced settings live in `.pivi/settings.json`; provider registry, environment entries, capability grants, external paths, and the session journal are device-local; credentials and other secrets live in `SecretStorage`. Absolute paths and secrets never enter synced files.
- **Safety boundaries**: all HTTP goes through purpose-scoped clients, local processes are bounded and shell-forbidden by default, vault mutations are contained and snapshot File Recovery first, and Bash, external reads, and Obsidian commands need grants. See `SECURITY.md`.
- **Upgrade floor**: startup runs no settings, credential, provider, or environment migration for formats older than 0.15.0. Still present: read compatibility for old session JSONL, the capability-permission record migration (0.26.0 / 0.28.0), MCP secret-ID and plaintext rewrites on load, and the one-time `.pivi/templates/` move.

The per-subsystem detail and the module maps live in [docs/12-architecture-status.md](docs/12-architecture-status.md). Read the paragraph for the subsystem you are changing before you edit it, and update it in the same change.

### Repo terminology glossary

Use this glossary as the source of truth when naming docs, UI concepts, types, and persistence fields. Prefer the canonical term for new code.

#### Architecture and runtime terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|---|---|---|---|
| **PiChatService** | Narrow UI/app-facing contract for the one Pi chat lifecycle: prepare turns, stream, sync session, rewind, cleanup. | UI and app service typing; only contract product UI may depend on for chat. | Generic `ChatService` names or direct Pi runtime dependencies. |
| **PiChatRuntime** | Concrete `PiChatService` implementation backed by an in-process Pi `Agent`. Constructed only in app composition (`createChatService`). | Runtime implementation, app factories, and engine tests. | Importing `PiChatRuntime` from `src/ui/**`. |
| **Pi engine package** | `@pivi/engine-pi`, the owner of low-level Pi SDK imports, Pi prompts consumption, event adaptation, auth/model helpers, auxiliary queries, tool adaptation, and Obsidian-safe Pi SDK shims. | Package boundary docs and imports. | Scattering raw `@earendil-works/*` imports into UI/tools/host packages. |
| **Pivi ToolSpec** | Minimal tool protocol type owned by `@pivi/agent/tools`; concrete implementations return `ToolSpec` values before runtime adaptation. | Tool protocol, Obsidian tools, runtime registry. | Raw Pi `AgentTool` outside `@pivi/engine-pi`. |
| **Obsidian host package** | `@pivi/obsidian-host`, the adapter package for vault APIs, file stores, settings persistence, shared/secret storage, host context, paths, and renderer compatibility. | Obsidian-facing package boundaries and concrete host adapters. | Inventing a monolithic `ObsidianHost` aggregate, treating workspace/editor UI as host context, or importing Obsidian APIs in platform-neutral packages. |
| **Obsidian tool package** | `@pivi/obsidian-tools`, the concrete implementation package for Obsidian-backed Pivi tools. | Tool execution docs and imports. | Putting Obsidian tool execution in `@pivi/agent/tools` or UI renderers. |
| **Auxiliary query** | Short Pi run for title generation or refine, without a full chat session lifecycle. | Title generation and refine flows. | Calling it a session or chat turn unless it persists into session history. |
| **Runtime state** | In-memory Pi `Agent` / `PiChatRuntime` state for an active tab. Rebuildable from session data. | Runtime sync and hydration. | Treating runtime state as the source of truth. |
| **Subagent card** | One transcript card for one delegated execution, keyed by its persisted spawn-tool ID and updated through the owning tool entity. | Prompt, nested tools, visible result, localized status, and running-only motion. | Grouping sibling subagents, composer activity shelves, or exposing report-protocol JSON. |
| **Memory boundary** | Low-contrast transcript divider/chip for compaction, recovery, or older-history paging; it is context metadata rather than a message. | Approximation-marked context transitions and paging boundaries. | Fake assistant messages or invented token values. |

#### Session and message terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|---|---|---|---|
| **Session** | Durable chat conversation persisted as JSONL under `.pivi/sessions/`. | User-facing history/resume/fork docs, storage specs, persisted state. | Old chat-thread wording for durable identity. |
| **Session file** | Vault-relative `.jsonl` path for one persisted conversation. | Persisted tab state, session stores, history list. | Hiding it inside opaque `agentState`. |
| **SessionRef** | Pivi durable session identity, normally `{ sessionFile }` plus the JSONL header session id. | Runtime/UI/session handoff and tab restore. | Runtime ids, UI tab ids, or `leafId` as durable history identity. |
| **Leaf** / **leafId** | Pi JSONL compatibility detail for old tree-shaped session files. Pivi no longer restores a specific leaf; opening history restores the complete linear session. Fork creates a new session file from a selected entry. | Low-level Pi session compatibility only. | Using leaf selection as product history/restore state. |
| **Tab binding** | UI tab's durable binding to `sessionFile` plus draft UI state such as selected model. | `.pivi/tab-manager-state.json` and tab restore logic. | Deprecated chat-id fields or `leafId` as durable tab identity. |
| **Open session state** / **OpenSessionState** | In-memory UI projection of a session used while rendering and streaming an open tab. Rebuildable from JSONL. | Controllers, presenters, transient UI state. | Treating it as durable identity. |
| **openSessionId** | In-memory identifier for open session state. | Feature-layer tab/state lookup only. | Persisting it as tab restore identity. |
| **Checkpoint** | Versioned structured continuation state stored additively in `compaction.details.piviCheckpoint` while retaining the readable Pi summary. | Compaction persistence, chained decision/artifact ledger, future checkpoint presentation. | Replacing Pi compaction fields or treating malformed details as required context. |
| **Agent report** | Versioned compact result emitted by a subagent for parent context: objective/outcome plus optional summary, findings, decisions, vault-relative artifacts, and open questions. | `spawn_agent` parent handoff and persisted recovery; terminal text remains fallback/UI trace. | Treating the complete child trace as the structured report or persisting absolute artifact paths. |
| **Turn** | One user submission plus resulting assistant/tool stream and persisted updates. | Runtime, prompt, streaming, tests. | “Message” when referring to the whole request/response cycle. |
| **Message** | A user/assistant/tool content item inside a turn/session. | Rendering, JSONL message entries, chat state. | “Message” for the whole session or turn lifecycle. |

#### Prompt, MCP, and tool terms

| Term | Meaning | Use in code/docs | Avoid / legacy wording |
|---|---|---|---|
| **System prompt** | Long-lived agent instructions assembled by `@pivi/agent/prompt` and consumed by the Pi engine. | Runtime configuration, prompt architecture docs. | Per-message context payloads. |
| **Prompt module** | Owned body of system-prompt guidance with a stable id and kind (`core` locked, `workflow` composable, or `custom` user-created). | `@pivi/agent/prompt` registry, Settings Prompt tab, main-Agent `pivi_prompt`, synced `promptModules` / `customPromptModules`. | Treating `mainAgent.ts` as one monolithic template, or using runtime `appendices` as the user-facing extension point. |
| **Turn prompt** | Per-message payload built by runtime prompt helpers; may include context files XML and MCP mention transforms. | Turn preparation, prompt/context specs. | API-transformed prompt text as user-visible history. |
| **MCP mention** | User-facing `/server` or `/server/tool` slash token; turn finalization may append ` MCP` for the API prompt. Optional emphasis — settings-enabled servers are already available. | Composer slash badges, prompt transforms. | Requiring toolbar selection or an at-sign server token as the only activation path. |
| **Built-in tool mention** | A slash token backed by a Settings > Tools capability rather than a prompt command. `/generate-image` is currently the sole built-in tool mention and maps to `obsidian_generate_image` only while that tool is enabled. | Slash selector, composer/history badge, API-only prompt transform. | Storing an expanded prompt template in the composer/session or listing the token under Commands settings. |
| **Proxy MCP tool** | Single Pi tool `mcp` that searches/calls vault MCP servers instead of exposing one Pi tool per MCP tool. | Pi tool registry, MCP bridge docs. | Describing vault MCP tools as top-level Pi tools. |
| **Vault-local MCP** | `.pivi/mcp.json`, with OAuth entries in `SecretStorage`; Pivi does not read or write host-global MCP configs. | MCP settings, OAuth, storage docs. | Global paths such as `~/.config/mcp` or IDE host MCP configs. |
| **TodoVisualizationModel** | UI-facing todo projection derived from TodoWrite tool input: items, active item, progress counts, and source. | `@pivi/agent/tools`, todo presenters/renderers, session restore. | Parsing raw TodoWrite payloads in renderers. |


## 🛠️ Development & Build Commands

**Node.js:** `24.x` (see `package.json` `engines`, `.nvmrc`, and `mise.toml`). CI and release workflows use Node 24.x; local development must use the same major. With [mise](https://mise.jdx.dev/) installed, `mise install` in the repo root activates `node@24.19.0`.

Use `npm ci` for a clean install. `.npmrc` enables `legacy-peer-deps=true`; do not enable `engine-strict`, because Obsidian's community scanner installs dependencies under its own Node version before linting. `postinstall` creates `.env.local` from `.env.local.example` outside CI when missing.

### TypeScript and dependency resolution

- `typescript` is the TS6 compatibility compiler (`npm:@typescript/typescript6`), used by ESLint and ts-jest. Editors should use this project compiler.
- `typescript-native` is TS7 and is the authoritative root CLI checker: `npm run typecheck` runs source and test projects through `node_modules/typescript-native/bin/tsc`.
- `noUnusedLocals` and `noUnusedParameters` are enabled for source and tests. Delete an unread local, private member, import, or parameter instead of leaving it; prefix a parameter with `_` only when a signature you do not own requires it.
- `npm run check:dead-code` (knip, configured in `knip.json`, part of `check:boundaries`) rejects unused files and exports that no other module imports. Export a symbol only when another module or test imports it. `@pivi/agent`, `@pivi/engine-pi`, and `@pivi/obsidian-host` expose source leaves through a `./*` wildcard export, so `knip.json` sets `includeEntryExports` for them and every export is checked against real importers. A file whose exports are consumed only through a build-plugin path string must be listed under that workspace's `ignore`; a file reached only through a child-process `import` in a test must be listed as an `entry`. Dependency findings are deliberately excluded because workspace `@pivi/*` aliases report as unlisted.
- Do not add workspace `typecheck` forwarding scripts: the root command owns all `src/` and `packages/` source, while `tests/tsconfig.json` owns Jest types.
- Every workspace package must declare the third-party and `@pivi/*` packages imported by its source. Runtime imports and re-exports require `dependencies`, `optionalDependencies`, or `peerDependencies`; type-only imports may use `devDependencies`. Obsidian and React runtimes are explicit peers. `check:architecture` also verifies every declared export resolves through the active npm workspace link.
- Keep `legacy-peer-deps=true` until `npm install --dry-run --ignore-scripts --legacy-peer-deps=false` succeeds. As of 2026-10-09, `obsidian@1.14.4` requires exact `@codemirror/view@6.43.13` while Pivi uses a newer `^6.43.x` range, and `eslint-plugin-obsidianmd@0.4.2` pins `obsidian@1.8.7` plus `@eslint/js ^9` peers under an ESLint 10 root.
- Consolidate onto TS7 only after ts-jest, typescript-eslint, and dependent plugins explicitly support its compiler API. If TS7 CLI checking regresses, temporarily point root `typecheck` at `node_modules/typescript/bin/tsc6 --noEmit`; retain both aliases for rollback.

All development flows should be managed using the following standard `npm` scripts (the lint script covers `src/`, `tests/`, and `packages/`):

```bash
# Install exact dependencies
npm ci

# Build CSS once, then start esbuild in watch mode
npm run dev

# Concatenate and validate CSS import graph
npm run build:css

# Run typechecking (tsc)
npm run typecheck

# Run linter checks (ESLint + simple-import-sort + obsidianmd rules)
npm run lint

# Automatically fix linting and import-sorting issues
npm run lint:fix

# Run all unit tests with Jest
npm run test

# Run tests in watch mode
npm run test:watch

# Generate test coverage reports
npm run test:coverage

# Compile production CSS and package bundle (main.js + styles.css)
npm run build

# Generate metafile.json for bundle inspection
npm run analyze:bundle
```

`build/` owns shared esbuild options, externals, runtime compatibility shims, dynamic `node:` import postprocessing, and Obsidian artifact deployment. Production and bundle analysis must both use `createBuildOptions`; change output rewrite regexes only with a matching fixture and regression test.

```bash
# Sync package version into manifest.json, versions.json, and the README badge
node scripts/sync-version.js
```

### Focused Jest commands

Always run Jest through `npm run test` / `scripts/run-jest.js`; the wrapper supplies the Node localStorage file used by tests.

```bash
# One file
npm run test -- tests/unit/agent/mcp/mcpToolBridge.test.ts

# One file in-band
npm run test -- --runInBand tests/unit/agent/mcp/mcpToolBridge.test.ts

# By test name
npm run test -- -t "prefetches enabled remote servers"

# By directory/path fragment
npm run test -- tests/unit/utils
```

### Agent default post-implementation workflow

Unless the user opts out, after completing an implementation in this repo the agent should deploy to the configured vault and reload Obsidian:

```bash
npm run build && obsidian plugin:reload id=pivi
```

Requires `.env.local` with `OBSIDIAN_VAULT` (see manual integration testing below). Official CLI commands target the vault of the current working directory, or `vault=<name>`; `obsidian --help` is not a valid invocation. Optional sanity check: `obsidian dev:errors` (expect `No errors captured.`).

For changes that affect **rendered CSS**, do not commit or push until the user has visually confirmed the result in the reloaded UI (Coding Standards #11).

**Obsidian plugin folder layout:** Deploy only `main.js`, `manifest.json`, and `styles.css`. Obsidian may also create `data.json` at runtime. Do not copy CLI entrypoints, `node_modules`, or other pi-coding-agent artifacts into `.obsidian/plugins/pivi/` — the esbuild `copy-to-obsidian` plugin prunes stale files on each build.

---

## 🧪 Testing Workflows

### 1. Automated Testing (Unit & Integration Tests)
We use Jest (multi-project config) for unit and integration tests. Unit tests live under `tests/unit/**` and integration tests under `tests/integration/**`, both using mocks in `tests/__mocks__/` and helpers in `tests/helpers/`.

To run all tests:
```bash
npm run test
```

The test runner automatically mounts `tests/setupWindow.ts` to mock renderer globals (`window`, `requestAnimationFrame`, `cancelAnimationFrame`) and fail the owning test on unexpected `console.warn` / `console.error`; intentional log paths must mock and assert their call in the specific test. Jest maps `obsidian` and the Pi engine packages to mocks under `tests/__mocks__/`; `@earendil-works/pi-mcp` and `pi-ai/dist/*` resolve to the real packages.

CI runs the stronger coverage command across all Jest projects:

```bash
npm run test:coverage
```

---

### 2. Manual Integration Testing (Obsidian CLI & Auto-Deploy)
To verify the plugin in a live Obsidian vault environment, utilize the built-in esbuild auto-deploy pipeline and the `obsidian` CLI:

#### Step A: Configure local vault path
Create a `.env.local` file in the root of the project and specify your active vault's absolute path:
```env
OBSIDIAN_VAULT=/path/to/your/vault
```

#### Step B: Build and auto-deploy
Run the production build command. The `copy-to-obsidian` esbuild plugin will automatically copy the generated files (`main.js`, `manifest.json`, `styles.css`) directly into your vault:
```bash
npm run build
```

#### Step C: Enable the plugin on first install
Enable `pivi` after the first deployment; this step is not needed for subsequent builds. Official CLI commands target the vault of the current working directory, or `vault=<name>`:
```bash
obsidian plugin:enable id=pivi
```

#### Step D: Reload the plugin
Reload only `pivi` after subsequent builds so the rest of the vault remains undisturbed:
```bash
obsidian plugin:reload id=pivi
```

#### Step E: Trigger active commands
Open the sidebar chat view via the CLI:
```bash
obsidian command id=pivi:open-view
```

#### Step F: Verify stability (Console Logs)
Check Obsidian developer errors log to confirm initialization ran cleanly with zero errors:
```bash
obsidian dev:errors
# Output should return: "No errors captured."
```

---

## 📈 Quality gates and current risks

Keep this section durable. Do not record point-in-time test counts, coverage percentages, bundle byte counts, dated audits, or completed action ledgers here; derive current values from the repository checks and keep historical release evidence in the numbered handbook or archived specs.

- **PR readiness:** do not open a pull request until this local CI-equivalent suite is green: `npm run check:dependencies && npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`. GitHub CI is confirmation, not the first run. Fix failures locally and push the fix before opening or re-requesting review.
- **Release readiness:** keep the same suite green. The combined boundary gate includes `check:docs-contracts` against `docs/capabilities.json`, `check:dead-code` (knip unused files and exports), and `check:pi-compatibility` against the engine compatibility manifest. The dependency audit (`scripts/check-dependency-audit.mjs`) rejects any known npm advisory except an expiring, exact-path entry in `scripts/dependency-audit-allowlist.json`; add one only when npm overrides cannot reach the pin (for example a dependency's own shrinkwrap) and the code is not in `main.js`. CI also runs focused `test:platform-security` on macOS/Windows. Pull requests receive a base/head metafile summary with bundle delta, largest inputs, and embedded Skills CLI size; growth above 100 KiB or 2% is informational, while the 5 MiB ceiling remains mandatory. Release publication uses the same shared quality-gate action for the exact tag commit. Configuration files and CI are the source of truth for thresholds, including direct branch thresholds on security-critical modules.
- **Review discipline:** treat new `any`, direct production `console` calls, complexity, and max-lines findings as review blockers unless the owning code documents a concrete reason. `complexity` (25) and `max-lines` (600) are errors for both `src/**` and `packages/**`; pre-existing package violations are recorded in `.config/eslint-suppressions.json` (ESLint bulk suppressions). Never add to that file to land new code; after splitting a suppressed file or function, run `npm run lint:prune-suppressions` and commit the smaller file, because unpruned suppressions fail `npm run lint`. Never move the file back to the repo root as `eslint-suppressions.json`: ESLint auto-loads that path, and the Obsidian community review scan runs ESLint from the repo root with its own config, so every suppression looks unused, ESLint exits 2, and the source-code review fails with a fatal error.
- **Coverage risk:** app-layer imperative settings and mention interactions remain broader than their focused regression coverage. Add behavior-level tests when changing settings hotkey/port wiring or the mention controller; do not infer surface completeness from global coverage alone.
- **Chat performance:** keep deterministic Jest invariants and the real-Obsidian measurement protocol aligned with `docs/11-chat-ui-evolution.md`; do not publish timing, memory, or bundle claims without a fresh measurement.
- **Release evidence:** keep migration provenance and environment-dependent live verification in `docs/10-roadmap-release-and-maintenance.md`, not in this operational guide.
- **CSS and UI copy:** `build-css.mjs` enforces zero `!important` across build inputs; Obsidian sentence-case lint and `scripts/check-i18n-dead-keys.mjs` must remain green.
- **Rendered-CSS visual sign-off:** required before commit; see Coding Standards #11.
- **Service boundary:** preserve the narrow injected `PiChatService`; never import `PiChatRuntime` from `src/ui/**`.

---

## 📝 Coding Standards & Guidelines

1. **SDK Service Boundaries**: Feature/app code uses Pivi-owned package APIs (`@pivi/*`) and the app shell. Raw Pi SDK imports belong only to `@pivi/engine-pi`; the standalone `@earendil-works/pi-mcp` client is imported only by `@pivi/agent/src/mcp`, which owns MCP implementation and exposes Pivi contracts to every other layer.
2. **Ports & DI for host capabilities**: `@pivi/agent` and `@pivi/engine-pi` depend on `@pivi/agent/ports` contracts, not `@pivi/obsidian-host`. App composition injects host adapters (files, secrets, HTTP, process).
3. **UI over service contracts**: `src/ui/**` may use `PiChatService` / `AuxQueryRunner` from `@pivi/agent/runtime`, injected `@pivi/agent`-owned `ChatPorts`, and the `app`-only `PiviChatHost`. Chat runtime/session/model/catalog/settings behavior must use `ChatPorts`; `PiviChatCompositionHost` and `PiviSettingsHost` stay in app composition. UI must not import `@pivi/engine-pi/**`, `src/app/runtime/**`, or `@/app/ui/**`, and must never call `getPiWorkspace()`, `getUiFacades()`, `saveSettings()`, or `getAllViews()`.
4. **One-way app → UI composition**: `src/app/runtime/**` must not import `@/ui/**`. Host contracts must not import concrete `PiviViewHost`, app runtime implementation modules, or `@pivi/engine-pi` types. Composition root (`serviceGraph`, registrations, `src/app/ui`) may import UI modules to mount React roots and wire adapters. Do not inject a settings renderer into the service graph—settings mount only via `PiviSettingTabHost` + `SettingsPorts`.
5. **Comment Why, Not What**: Code should be self-documenting for "what" it does. Write comments specifically to describe "why" design choices, protocols, or edge cases were handled.
6. **Centralized production logging**: Do not call `console.log`, `console.warn`, or `console.error` directly outside the shared logger/bootstrap boundary. Route actionable warnings and errors through `PluginLogger`; keep intentional best-effort cleanup explicit without dumping user data.
7. **Pi Dependency Boundary**: see #1; every other package depends on `@pivi/agent` contracts, not raw Pi SDK packages.
8. **Pre-push Integrity Check**: run the local CI-equivalent suite from Quality gates before opening a pull request. Husky pre-commit runs `typecheck` + `lint` + `check:architecture`. CI rejects any known npm advisory not covered by an unexpired audit allowlist entry, runs the combined boundary checks (including `check:docs-contracts`, `check:pi-pins`, and `check:pi-compatibility`) before tests, and enforces the bundle-size ceiling after the production build. Release tags rerun the shared quality gates before publish. Third-party Actions in privileged workflows are pinned to full commit SHAs.
9. **Document decisions**: Keep architecture rationale and end-to-end flows in the relevant numbered `docs/` page. Keep enforceable boundaries, local invariants, gotchas, and verification notes in the nearest owning `AGENTS.md`; prefer package-local guidance over growing root guidance.
10. **UI text requires i18n (every commit)**: Any change that adds or edits **user-visible** UI copy (settings labels/descriptions, buttons, Notices, placeholders, aria-labels, command/ribbon names, chat chrome, empty states, tool display labels, modals, etc.) **must** ship i18n in the **same commit**:
   - Add/update keys in `packages/pivi-react/src/i18n/locales/en.json` (canonical), then mirror the key tree in **all** other locale JSON files with translations.
   - Legacy imperative UI uses the app-owned translator from `@/app/i18n`; React package components use `useT()` under `I18nProvider`. Do not leave new hard-coded English (or any single language) in product UI.
   - Prefer sentence case for settings/UI copy (ESLint `obsidianmd/ui/sentence-case`).
   - Packages other than `@pivi/pivi-react` receive translated strings when host/package code surfaces Notices or labels; they must not import app translator state.
   - Intentional exceptions: technical identifiers (tool ids, model/provider ids), brand names used as identifiers, and raw user content.
   - Details and catalog workflow: `packages/pivi-react/src/i18n/AGENTS.md`.
11. **Rendered-CSS changes need human visual sign-off**: CSS changes that affect what is rendered (sizing, hit boxes, hover/focus emphasis, spacing, color, layout, motion) must not be committed or pushed on automated-gates-green alone. The agent must `npm run build` and reload the plugin, then hand the affected surface back to the user for visual confirmation in the live UI before committing. The agent must never self-attest visual QA, mark a visual verification item done, or claim a rendering change "looks right" or "is verified" on its own, because an agent cannot see the rendered UI. Innocuous-looking CSS (for example a textbook accessibility `min-width: 32px` hit box) can produce visible regressions (an oversized hover/outline block around a small icon) that automated tests and code review do not catch; only eyes on the UI catch them. When enlarging a control's hit box beyond its visible glyph, keep hover/focus emphasis scoped to the glyph, not the full hit box.

### File naming

- Use `PascalCase.ts` for UI files whose primary export is a PascalCase class, component, modal, controller, manager, presenter, renderer, or similarly named UI object (for example `MessageRenderer.ts`, `InputController.ts`, `SlashCommandDropdown.ts`).
- Use `lowerCamelCase.ts` for helper modules, parsing/formatting utilities, data mappers, state helpers, and modules whose primary exports are functions or constants.
- Keep package-layer modules under `packages/*/src` lowerCamelCase by default; reserve PascalCase there only for a primary exported type/object that benefits from matching file and symbol names.
- Do not keep UI-named facade files that only re-export package-layer helpers. Import those helpers from the owning `@pivi/*` package instead, or delete the unused facade.

### CI/CD and release

- `.github/workflows/ci.yaml` runs on PRs and pushes to `main`: `npm ci`, `npm run check:dependencies`, `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run test:coverage`, `npm run build`, and `npm run check:bundle-size`. PR runs additionally build base/head metafiles and append the non-blocking relative-growth report to the job summary.
- **Obsidian release invariant:** the Git tag and GitHub Release tag must exactly equal the **published** `manifest.json.version` with **no leading `v`**. On `main`, root `manifest.json` tracks the stable community-plugin channel; beta tags may keep the committed root manifest on the previous stable version while the tag-push release workflow writes the release asset manifest from `package.json`.
- **Beta / pre-release route:** publish semver prerelease tags from the `next` or `beta` branch with `npm run version:beta`, push the annotated tag, and let `.github/workflows/release.yaml` mark the GitHub Release as a Pre-release. Do not bump root `manifest.json` / `versions.json` / the README badge for prerelease versions; `scripts/sync-version.js` skips those files automatically. Full maintainer and tester guidance lives in [docs/10-roadmap-release-and-maintenance.md](docs/10-roadmap-release-and-maintenance.md).
- **Standard release path:** bump with `npm version patch|minor|major --no-git-tag-version` as appropriate (pre-1.0: `fix` → patch, `feat` → minor), run `node scripts/sync-version.js`, add the matching `CHANGELOG.md` section, commit as `chore(release): prepare x.y.z`, and push `main`. Then create an annotated tag with `git tag -a x.y.z -m "x.y.z"` and push it with `git push origin x.y.z`. The `push.tags` event directly triggers `.github/workflows/release.yaml` and builds the exact tagged commit. README badge updates come from `node scripts/sync-version.js`.
- **Post-merge branch cleanup:** after every PR merge, delete the merged source branch locally and from `origin` once no open PR or worktree still uses it.
- Both stable and beta publishing must avoid GitHub artifact attestations until Obsidian's live automated reviewer accepts the current GitHub/Sigstore bundles. Valid attestations that pass strict GitHub CLI verification currently fail the directory's cryptographic check, while newly accepted community plugins without attestations pass. Keep the release job at `contents: write` only. The build embeds the package version in JavaScript and CSS banners so every release asset has an unambiguous version-specific digest. The workflow must download the published assets and compare them byte-for-byte with the tag build before succeeding.
- `.github/workflows/release.yaml` is the single tag-push builder, release-note publisher, and asset uploader. Stable releases must have a non-empty matching `CHANGELOG.md` section; prerelease tags may use the workflow's short fallback note. Do not add `release`, `workflow_dispatch`, or main-branch fallbacks for publishing.

#### Version metadata SOP

The maintainer chooses the next version, writes the matching `CHANGELOG.md` section, and creates the annotated tag. The tag-push workflow extracts that changelog section as the GitHub Release notes and rejects missing or empty notes for stable tags.

`node scripts/sync-version.js` is the local source of truth for **stable** derived version metadata. It copies `package.json.version` into `manifest.json`, adds the matching `versions.json` entry, and rewrites the README version badge. Prerelease `package.json` versions skip that sync so the community-plugin channel stays stable. Beta tags rely on `scripts/write-release-manifest.js` inside `release.yaml` to emit a release asset manifest that matches the tag. Run `sync-version.js` after any stable `npm version --no-git-tag-version` bump.

### Obsidian Plugin API reference

Pivi-native agent tools (`packages/obsidian-tools/`) prefer the **in-process Obsidian Plugin API**. The official CLI is used only where the public API cannot satisfy the operation: history, tasks, daily-note resolution/reads, template resolution/creation, bookmarks, Base queries, command discovery, and command execution with an exact-ID grant or sidebar approval. Daily append/prepend uses the Vault API after resolving the exact path. Template insertion binds and snapshots the Markdown editor before replacing its selection in-process.

| Resource | URL |
|----------|-----|
| **API repo (types)** | [github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) |
| **DeepWiki (Q&A)** | [deepwiki.com/obsidianmd/obsidian-api](https://deepwiki.com/obsidianmd/obsidian-api) |
| **Hybrid tool guidance** | `packages/obsidian-tools/AGENTS.md` |

Public API covers `app.vault`, `app.metadataCache` (links, tags, frontmatter), `app.fileManager` (rename, trash, frontmatter, attachment paths), and `app.workspace` (open files). There is **no** public vault-wide full-text search API — Pivi implements scan-based search in `ObsidianVaultApi.searchNotes()`. There is also no public task index/mutation API, so `obsidian_tasks` remains CLI-backed.
