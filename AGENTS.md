# Obsius Developer Guide

Welcome to the **Obsius** developer reference guide. This document is the **operational** entry point: build, test, lint, and seam rules. **Design decisions and module architecture** live in [`docs/`](docs/README.md) (versioned with the repo).

---

## 📚 Design documentation

Obsius uses a four-layer doc system. Treat design docs as **decision assets** (why), not only descriptions (what).

| Layer | Location | When to update |
|-------|----------|----------------|
| Overview | [`docs/overview.md`](docs/overview.md), [`docs/glossary.md`](docs/glossary.md) | Rarely |
| Architecture | [`docs/architecture/`](docs/architecture/) | Module contract changes |
| ADR | [`docs/adr/`](docs/adr/) | Significant architectural choices |
| Specs | [`docs/specs/`](docs/specs/) | Medium+ features |
| Notes | [`docs/notes/`](docs/notes/) | Gotchas; promote when stable |

**Workflow**

1. Explore in Obsidian / Heptabase (optional).
2. Write or update a **spec** (`docs/specs/`) before implementing non-trivial features.
3. Add an **ADR** (`docs/adr/`) when choosing frameworks, boundaries, or irreversible tradeoffs.
4. Implement in `src/`; PR references spec + ADR.
5. Update **architecture** docs when the module’s public story stabilizes.

**PR checklist** (include in description when applicable):

```markdown
Related docs:
- Spec: docs/specs/…
- ADR: docs/adr/…
- Architecture: docs/architecture/…
```

| Change size | Documentation |
|-------------|----------------|
| Small fix | Comment or `docs/notes/` |
| Medium feature | `docs/specs/` |
| Architecture / framework | New or superseded ADR |
| Stable module API | `docs/architecture/` |

**Index:** [`docs/README.md`](docs/README.md)

---

## 🤖 Agent skills

Repo-local skills live under [`.agents/skills/`](.agents/skills/). Cursor and Pi discover them from that path (see `VaultSkillsService`); do not mirror into `.cursor/skills/` unless you need Cursor-only discovery on a machine that ignores `.agents/`.

| Skill | When to load |
|-------|----------------|
| [`obsidian`](.agents/skills/obsidian/SKILL.md) | Obsidian plugin API, ESLint/scorecard, manifest, a11y, CSS, submission |
| (future) `obsius-*` | Hexagonal seams, Pi adaptor, vault MCP — see `docs/` until added |

**Vault default bundle** (end users, not this repo): first vault load seeds [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) into `<vault>/.obsius/skills/` via `ensureDefaultVaultSkills` — see [`docs/specs/context-layers-spec.md`](docs/specs/context-layers-spec.md).

**Install / update** (pins versions in [`skills-lock.json`](skills-lock.json)):

```bash
npx skills add gapmiss/obsidian-plugin-skill
```

For Obsidian-specific quality rules (logging, `requestUrl`, `registerEvent`, touch targets), prefer the **obsidian** skill over repeating them here. This file stays **repo ops + architecture seams**.

Nested `AGENTS.md` files under `src/` and `tests/` are auto-generated directory maps (`init-deep`); treat root `AGENTS.md` and `docs/` as authoritative for cross-cutting rules.

---

## 🚀 Project Overview

**Obsius** (ID: `obsius2`) is an Obsidian community plugin that embeds the **Pi agent** (`@earendil-works/pi-agent-core`) as its sole agent runtime inside an Obsidian sidebar view and inline-edit modal.

**Minimum Obsidian:** `1.11.4` (provider API keys use `app.secretStorage` / keychain).

### Architecture Status
- **Hexagonal Architecture**: Strictly adheres to the ports-and-adapters design pattern. Runtimes, settings, and command catalogs are isolated behind agent ports (`src/core/agent/`). See [docs/architecture/system-architecture.md](docs/architecture/system-architecture.md) and [ADR-0002](docs/adr/0002-hexagonal-ports-and-adapters.md).
- **Pi Adaptor**: Located in `src/pi/`, this adaptor runs an in-process `Agent` from `pi-agent-core`, streams turns via `pi-ai`, and provides Pi-specific settings and UI selectors. See [ADR-0003](docs/adr/0003-pi-as-sole-agent-runtime.md).
- **Vault-local MCP**: `.obsius/mcp.json` and `.obsius/mcp-oauth/` only—no global host MCP configs. MCP mentions: `@server` in UI → `@server MCP` in API prompt. See [docs/specs/mcp-integration-spec.md](docs/specs/mcp-integration-spec.md) and [ADR-0004](docs/adr/0004-vault-local-mcp-config.md), [ADR-0005](docs/adr/0005-mcp-mention-transform.md).

---

## 🛠️ Development & Build Commands

**Node.js:** `>=24` (see `package.json` `engines` and `.nvmrc`). CI and release workflows use Node 24.x.

All development flows should be managed using the following standard `npm` scripts:

```bash
# Start esbuild and build:css in watch mode
npm run dev

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
```

### Agent default post-implementation workflow

Unless the user opts out, after completing an implementation in this repo the agent should deploy to the configured vault and reload Obsidian:

```bash
npm run build && obsidian reload
```

Requires `.env.local` with `OBSIDIAN_VAULT` (see manual integration testing below). Optional sanity check: `obsidian dev:errors` (expect `No errors captured.`).

**Obsidian plugin folder layout:** Deploy only `main.js`, `manifest.json`, and `styles.css`. Obsidian may also create `data.json` at runtime. Do not copy CLI entrypoints, `node_modules`, or other pi-coding-agent artifacts into `.obsidian/plugins/obsius2/` — the esbuild `copy-to-obsidian` plugin prunes stale files on each build.

---

## 🧪 Testing Workflows

### 1. Automated Testing (Unit Tests)
We use Jest for unit testing. Our test setup replicates the directory layout of `src/` inside `tests/`.

To run the unit tests:
```bash
npm run test
```
The test runner automatically mounts `tests/setupWindow.ts` to mock the Chrome animation frames (`requestAnimationFrame`, `cancelAnimationFrame`) and maps `obsidian` imports to the unified mock definitions under `tests/__mocks__/obsidian.ts`.

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

#### Step C: Reload Obsidian vault
Force Obsidian to scan the plugins directory and detect your newly copied/updated community plugin:
```bash
obsidian reload
```

#### Step D: Enable the plugin
Turn on `obsius2` using the CLI:
```bash
obsidian plugin:enable id=obsius2
```

#### Step E: Trigger active commands
Open the sidebar chat view via the CLI:
```bash
obsidian command id=obsius2:open-view
```

#### Step F: Verify stability (Console Logs)
Check Obsidian developer errors log to confirm initialization ran cleanly with zero errors:
```bash
obsidian dev:errors
# Output should return: "No errors captured."
```

---

## 📝 Coding Standards & Guidelines

1. **Strict Hexagonal Seam**: Components (`src/features/`) and hooks must only interact with abstract ports (`src/core/`) and **never** import from the Pi adaptor (`src/pi/`) directly. Bootstrap (`main.ts` via `bootstrapPiAgent()`, `app/settings/`) may wire `src/pi/` at startup. Install defaults: `core/settings/agentDefaults.ts` (see ADR-0008).
2. **Comment Why, Not What**: Code should be self-documenting for "what" it does. Write comments specifically to describe "why" design choices, protocols, or edge cases were handled.
3. **No `console.log` in Production**: Use `console.error` strictly for caught initialization errors. Avoid dumping logging outputs in the production build.
4. **Zero Domain Dependencies**: Files under `src/core/` and `src/core/types/` must have zero external library dependencies.
5. **Pre-commit Integrity Check**: Always run `npm run typecheck && npm run lint && npm run build` before pushing any changes to ensure complete compile and code hygiene.
6. **Document decisions**: Do not merge important boundary or framework choices without an ADR. Link specs/ADRs in the PR. Prefer updating `docs/architecture/` over growing this file.

### Key architecture docs

| Topic | Doc |
|-------|-----|
| System map | [docs/architecture/system-architecture.md](docs/architecture/system-architecture.md) |
| Adapter layer | [docs/architecture/framework-adapters.md](docs/architecture/framework-adapters.md) |
| Agent runtime | [docs/architecture/agent-runtime.md](docs/architecture/agent-runtime.md) |
| Context & turns | [docs/architecture/context-management.md](docs/architecture/context-management.md) |
| MCP & tools | [docs/architecture/tool-system.md](docs/architecture/tool-system.md) |
| Prompts | [docs/architecture/prompt-system.md](docs/architecture/prompt-system.md) |
| UI | [docs/architecture/ui-integration.md](docs/architecture/ui-integration.md) |

### Obsidian Plugin API reference

Obsius-native agent tools (`src/pi/tools/`) prefer the **in-process Obsidian Plugin API**; CLI is fallback only when API cannot satisfy the call.

| Resource | URL |
|----------|-----|
| **API repo (types)** | [github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) |
| **DeepWiki (Q&A)** | [deepwiki.com/obsidianmd/obsidian-api](https://deepwiki.com/obsidianmd/obsidian-api) |
| **Hybrid tool spec** | [docs/specs/obsidian-tools-spec.md](docs/specs/obsidian-tools-spec.md), [ADR-0009](docs/adr/0009-obsidian-native-tools.md) |

Public API covers `app.vault`, `app.metadataCache` (links, tags, frontmatter), and `app.fileManager`. There is **no** public vault-wide full-text search API — Obsius implements scan-based search in `ObsidianVaultApi.searchNotes()`.
