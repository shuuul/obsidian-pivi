# `tests/` — Jest tests

*This file extends the root [AGENTS.md](../AGENTS.md). Follow root guidance first, then these local rules.*

Unit and integration tests for Pivi run in Node via Jest 30. Use the npm scripts, not direct `npx jest`, because `scripts/run-jest.js` provides the Node localStorage file expected by Pi/Obsidian mocks.

## Test topology

```mermaid
flowchart TD
  Runner["npm run test<br/>scripts/run-jest.js"] -- "loads config" --> Jest["jest.config.js<br/>projects: unit + integration"]
  Jest -- "Node projects" --> Window["setupWindow.ts<br/>window + RAF shims"]
  Jest -- "obsidian-ui project" --> React["jsdom + Testing Library<br/>setupObsidianUi.ts"]
  Jest -- "moduleNameMapper" --> Mocks["__mocks__/<br/>Obsidian + Pi packages"]
  Unit["unit/**/*.test.ts"] -- "use" --> Helpers["helpers/<br/>fake runtime, mock app/plugin/settings"]
  Integration["integration/**/*.test.ts"] -- "use" --> Helpers
  Unit -- "exercise" --> Codebase["src/ (UI, app, i18n)<br/>+ packages/ (core, tools, host)"]
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
- `obsidian-ui/` — React/TSX behavior tests running in the dedicated jsdom project.
- `__mocks__/obsidian.ts` — unified Obsidian API mock.
- `__mocks__/@earendil-works/*` — Pi package mocks for agent core, pi-ai, OAuth, and coding-agent APIs.
- `helpers/` — fake `PiChatService`, mock `App`, plugin, and settings builders.
- `integration/` — integration-project tests that still run in Node using the shared mocks/setup.
- `unit/app/` — app service/session/settings persistence tests.
- `unit/architecture/` — dependency boundary and architecture guard tests.
- `unit/engine/` — host-neutral engine/runtime tests.
- `unit/features/` — feature UI/service tests such as chat tab lifecycle and fork flows.
- `unit/i18n/` — locale and translation tests.
- `unit/main/` — plugin lifecycle tests.
- `unit/pi/` — Pi engine, MCP, sessions, tools, runtime prompt, auth, and slash catalog tests.
- `unit/pivi-agent-core/` — aggregate package host/runtime contract tests.
- `unit/ui/` — UI component/rendering and settings UI tests.
- `unit/utils/` — pure utility tests.

## Patterns and constraints

- Prefer testing through explicit feature/plugin dependencies when validating feature-facing behavior.
- Pi and feature tests should import Pivi-owned package APIs (`@pivi/*`) or the app shell package; keep low-level external SDK mocks centralized.
- Keep mocks centralized in `__mocks__/` or `helpers/`; avoid ad hoc large inline mocks in each test.
- Existing unit and integration projects run in Node. Only `tests/obsidian-ui/**` runs in jsdom; keep DOM-heavy React tests there.
