# `scripts/` — Build, test, version, and analysis helpers

*This file extends the root [AGENTS.md](../AGENTS.md). Follow root guidance first, then these local rules.*

Small Node scripts backing `package.json` commands. Keep them single-purpose and runnable with `node scripts/<name>`.

## Build/test flow

```mermaid
flowchart LR
  CSS["build-css.mjs<br/>src/styles/index.css -> styles.css"] -- "then" --> Build["build.mjs<br/>production orchestration"]
  Build -- "runs" --> Esbuild["esbuild.config.mjs<br/>main.js bundle"]
  Analyze["analyze-bundle.mjs"] -- "writes" --> Meta["metafile.json"]
  Jest["run-jest.js"] -- "sets localStorage file" --> Tests["Jest unit project"]
  Version["sync-version.js"] -- "updates" --> Manifest["manifest.json + versions.json"]
```

## Files

- `build-css.mjs` — Concatenates CSS imports from `src/styles/index.css` into root `styles.css`; validates missing and unlisted CSS modules.
- `build.mjs` — Production build orchestrator: CSS first, then esbuild bundle.
- `analyze-bundle.mjs` — Generates `metafile.json` for esbuild bundle analysis.
- `run-jest.js` — Required Jest wrapper; supplies Node `--localstorage-file` isolation.
- `sync-version.js` — Syncs `package.json` version into `manifest.json` and `versions.json`.
- `postinstall.mjs` — Creates `.env.local` from example outside CI when missing.
- `check-architecture-boundaries.mjs` — Fails on forbidden imports across package seams; `src/ui/**` must not import raw `@earendil-works/*`; `packages/**` must not import `src/**`; verifies `src/main.ts` is the only Obsidian `Plugin` composition root.
- `check-package-readmes.mjs` — Fails when any `packages/*/README.md` is missing Purpose / Allowed dependencies / Forbidden dependencies / Public API sections.

## Gotchas

- Do not bypass `run-jest.js` for normal test runs; direct Jest may use different localStorage behavior.
- `build-css.mjs` intentionally fails if a CSS file under `src/styles/` is not imported by `src/styles/index.css`.
- Release workflows upload only `main.js`, `manifest.json`, and `styles.css`.
- Keep architecture/readme checks single-purpose and dependency-light; they are run both directly and from Jest smoke tests.
