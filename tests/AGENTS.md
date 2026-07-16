# `tests/` — Jest tests

*This file extends the root [AGENTS.md](../AGENTS.md). Follow root guidance first, then these local rules.*

Unit and integration tests for Pivi run in Node via Jest 30. Use the npm scripts, not direct `npx jest`, because `scripts/run-jest.js` provides the Node localStorage file expected by Pi/Obsidian mocks.

## Test topology

```mermaid
flowchart TD
  Runner["npm run test<br/>scripts/run-jest.js"] -- "loads config" --> Jest["jest.config.js<br/>projects: unit + integration + pivi-react"]
  Jest -- "Node unit project" --> Window["setupWindow.ts<br/>window + RAF shims"]
  Jest -- "pivi-react project" --> React["jsdom + Testing Library<br/>setupObsidianUi.ts"]
  Jest -- "moduleNameMapper" --> Mocks["__mocks__/<br/>Obsidian + Pi packages"]
  Unit["unit/**/*.test.ts"] -- "use" --> Helpers["helpers/<br/>fake runtime, mock app/plugin/settings"]
  Integration["integration/**/*.test.ts<br/>included in unit project"] -- "use" --> Helpers
  Unit -- "exercise" --> Codebase["src/ (app + runtime adapters)<br/>+ packages/ (core, host, tools, React + i18n)"]
  Integration -- "exercise" --> Codebase
```

## Commands

```bash
# All Jest projects
npm run test

# List tests across projects
npm run test -- --listTests

# Coverage (CI command)
npm run test:coverage

# One file
npm run test -- tests/unit/pi/piMcpBridge.test.ts

# One file in-band
npm run test -- --runInBand tests/unit/pi/piMcpBridge.test.ts

# By test name
npm run test -- -t "merges toolbar-enabled servers"
```

## Layout

- `setupWindow.ts` — ensures `globalThis.window` and animation-frame shims exist.
- `setupObsidianUi.ts` — installs Testing Library DOM matchers for the jsdom React project.
- `pivi-react/` — React/TSX behavior tests running in the dedicated jsdom project, including Activity presentation, individual subagent slots, projection identity, composer, and settings suites.
- `pivi-react/` also hosts owner-DOM tests for the uncontrolled rich composer and imperative mention dropdown when real selection, keyboard, and Obsidian DOM-helper behavior matters.
- `__mocks__/obsidian.ts` — unified Obsidian API mock.
- `__mocks__/@earendil-works/*` — Pi package mocks for agent core, pi-ai, OAuth, and coding-agent APIs.
- `helpers/` — fake `PiChatService`, mock `App`, plugin, and settings builders.
- `integration/` — integration tests included in the Node `unit` Jest project and using the shared mocks/setup. Session append/fingerprint coverage that must exercise the real Pi writer runs a `NODE_ENV=production` subprocess so Jest's in-memory `SessionManager` mock cannot hide filesystem regressions.
- `fixtures/sessions/` — immutable Pi JSONL compatibility inputs. Hand-authored legacy/checkpoint shapes remain explicitly synthetic; `tag-generated-pivi-0.7.0-v3.jsonl` is reproducible output from the immutable 0.7.0 `PiSessionStore` writer over synthetic non-sensitive content, not a captured user vault. Copy every fixture to a temporary directory before open/migration tests and never mutate it in place or relabel the synthetic legacy-v1 shape as 0.7.0 data.
- `unit/app/` — app service/session/settings persistence tests.
- `unit/architecture/` — dependency boundary and architecture guard tests.
- `unit/engine/` — host-neutral engine/runtime tests.
- `unit/features/` — feature UI/service tests such as chat tab lifecycle and fork flows.
- `unit/main/` — plugin lifecycle tests.
- `unit/pi/` — Pi engine, MCP, sessions, tools, runtime prompt, auth, and slash catalog tests.
- `unit/pivi-agent-core/` — aggregate package host/runtime contract tests.
- `unit/scripts/` — build compatibility, CSS manifest, Jest project-discovery, and repository spec-validation tests.
- `unit/ui/` — imperative DOM and response/tool/subagent CSS contract tests; React and settings behavior belongs in `pivi-react/`.
- `unit/utils/` — pure utility tests.

## Patterns and constraints

- Prefer testing through explicit feature/plugin dependencies when validating feature-facing behavior.
- Pi and feature tests should import Pivi-owned package APIs (`@pivi/*`) or the app shell package; keep low-level external SDK mocks centralized.
- Keep mocks centralized in `__mocks__/` or `helpers/`; avoid ad hoc large inline mocks in each test.
- Existing unit and integration tests run together in the Node `unit` project. Only `tests/pivi-react/**` runs in jsdom; keep DOM-heavy React tests there.
- Chat performance tests assert deterministic invariants rather than speculative speedups: one projection commit per fake animation frame, at most 20 mounted rows in the fixed 5K jsdom viewport, 100-message projection pages, at most 67 projection commits for the exact 102,400-byte / 64-chunk development stream, persistence-free 10-tab / 20-switch cleanup, isolated 20-subagent fixture restoration/cleanup, stable entity identity, safe Markdown sealing, and synchronous lifecycle flushes. Record timing/heap claims only from the three-run real-Obsidian protocol and budgets in `docs/11-chat-ui-evolution.md`.
- Architecture fixtures lock the four ownership seams: core owns runtime/application ports, app owns concrete wiring, `@pivi/pivi-react` owns React presentation, and `src/ui` owns remaining product orchestration and imperative adapters. React portability fixtures additionally reject host DOM classes, host-specific public port identifiers, host-specific locale keys, and unparameterized credential/workspace copy while proving that `pivi-*` classes and app-owned host adapters remain valid.
