# Getting started

[Back to the developer handbook](README.md)

Pivi is an npm-workspace TypeScript project that builds one Obsidian desktop-plugin bundle. Node.js 24 or newer is required; CI uses Node 24.x.

## Prepare the checkout

```bash
nvm use
npm ci
```

`npm ci` installs the exact lockfile. The repository `.npmrc` enables `legacy-peer-deps=true`, and `postinstall` creates `.env.local` from the example outside CI when it is missing. Do not switch package managers or relax peer-dependency handling as part of an unrelated change.

Editors should use the project TypeScript version. TypeScript 6 compatibility packages support ESLint and ts-jest, while `typescript-native` (TypeScript 7) is the authoritative command-line checker invoked by `npm run typecheck`.

## Configure a development vault

Set the absolute path of a disposable or development vault in `.env.local`:

```env
OBSIDIAN_VAULT=/absolute/path/to/development-vault
```

Production builds copy only `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/pivi/` in that vault. The deployment step removes stale plugin artifacts; do not manually copy dependencies or CLI files into the plugin directory.

## Repository tour

| Path | Responsibility |
|---|---|
| `src/main.ts` | Obsidian `Plugin` composition root |
| `src/app/` | Lifecycle, service graph, commands, view/settings hosts, and concrete port wiring |
| `src/ui/chat/` | Tab/session orchestration, turn handling, streaming, and imperative adapters |
| `src/ui/inline-edit/` | Obsidian/CodeMirror bridge for inline editing |
| `packages/pivi-agent-core/` | Host-neutral foundations, sessions, prompts, tools, runtime contracts, and Pi engine |
| `packages/pivi-react/` | Product React surfaces, stores, ports, localization, and CSS |
| `packages/obsidian-host/` | Obsidian-backed host adapters |
| `packages/obsidian-tools/` | Concrete Obsidian agent tools |
| `tests/` | Jest unit, integration, and React/jsdom projects |
| `scripts/` and `build/` | Build, validation, version, and packaging logic |

Before editing, read root `AGENTS.md` and the nearest nested `AGENTS.md`. For example, an input change normally requires `src/ui/AGENTS.md`, `src/ui/chat/AGENTS.md`, and any guidance below the exact directory being changed.

## Development routes

Use watch mode while iterating:

```bash
npm run dev
```

It starts esbuild and the CSS builder in watch mode. For a reliable Obsidian inspection, use the production path:

```bash
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
```

`obsidian dev:errors` should report `No errors captured.` The broader `obsidian reload` command remains useful when a full vault reload is required.

## A first safe change

For a small UI-copy change:

1. Find the owning React or imperative surface and its closest `AGENTS.md`.
2. Update the canonical English key in `packages/pivi-react/src/i18n/locales/en.json` and mirror the same key tree in every locale in the same commit.
3. Use `useT()` in React or the app translator in imperative UI; do not hard-code product copy.
4. Run the nearest focused test, then `npm run lint` and `npm run typecheck`.
5. Build and reload Pivi because the user-visible UI changed.
6. Before committing, review the staged diff and update the affected developer document or nested `AGENTS.md` if the described behavior or boundary changed.

For a runtime change, start with [Architecture and technology](02-architecture-and-technology.md) and [Plugin lifecycle and composition](03-plugin-lifecycle-and-composition.md). For feature work, follow the links in the handbook index.

## Common setup failures

- A build that does not deploy usually means `OBSIDIAN_VAULT` is missing or points at the wrong vault.
- Obsidian CLI commands require the official CLI to be enabled in Obsidian settings.
- Tests must run through `npm run test`; `scripts/run-jest.js` supplies the test-local storage environment.
- A type result from an editor using a global TypeScript installation is not authoritative.
- Build output and caches are generated artifacts. Do not commit them unless the repository already tracks the specific release artifact.
