# Obsius Developer Guide

Welcome to the **Obsius** developer reference guide. This document serves as the sole source of truth for plugin architecture, coding conventions, development commands, and testing workflows.

---

## 🚀 Project Overview

**Obsius** (ID: `obsius2`) is an Obsidian community plugin that embeds the **Pi agent** (`@earendil-works/pi-agent-core`) as its sole default provider inside an Obsidian sidebar view and inline-edit modal.

### Architecture Status
- **Hexagonal Architecture**: Strictly adheres to the ports-and-adapters design pattern. Runtimes, settings, and command catalogs are isolated behind agent ports (`src/core/agent/`).
- **Pi Adaptor**: Located in `src/pi/`, this adaptor runs an in-process `Agent` from `pi-agent-core`, streams turns via `pi-ai`, and provides Pi-specific settings and UI selectors.

---

## 🛠️ Development & Build Commands

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
OBSIDIAN_VAULT=/Users/shuuul/Library/Mobile Documents/iCloud~md~obsidian/Documents/shuuul
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

1. **Strict Hexagonal Seam**: Components (`src/features/`) and hooks must only interact with abstract ports (`src/core/`) and **never** import from the Pi adaptor (`src/pi/`) directly. Bootstrap (`main.ts`, `app/settings/`) may wire `src/pi/` into registries at startup.
2. **Comment Why, Not What**: Code should be self-documenting for "what" it does. Write comments specifically to describe "why" design choices, protocols, or edge cases were handled.
3. **No `console.log` in Production**: Use `console.error` strictly for caught initialization errors. Avoid dumping logging outputs in the production build.
4. **Zero Domain Dependencies**: Files under `src/core/` and `src/core/types/` must have zero external library dependencies.
5. **Pre-commit Integrity Check**: Always run `npm run typecheck && npm run lint && npm run build` before pushing any changes to ensure complete compile and code hygiene.
