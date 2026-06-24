# `scripts/` — Build, test, version, and analysis helpers

Small Node scripts backing `package.json` commands. Keep them single-purpose and runnable with `node scripts/<name>`.

## Build/test flow

```mermaid
flowchart LR
  CSS["build-css.mjs<br/>src/style/index.css -> styles.css"] -- "then" --> Build["build.mjs<br/>production orchestration"]
  Build -- "runs" --> Esbuild["esbuild.config.mjs<br/>main.js bundle"]
  Analyze["analyze-bundle.mjs"] -- "writes" --> Meta["metafile.json"]
  Jest["run-jest.js"] -- "sets localStorage file" --> Tests["Jest unit project"]
  Version["sync-version.js"] -- "updates" --> Manifest["manifest.json + versions.json"]
```

## Files

- `build-css.mjs` — Concatenates CSS imports from `src/style/index.css` into root `styles.css`; validates missing and unlisted CSS modules.
- `build.mjs` — Production build orchestrator: CSS first, then esbuild bundle.
- `analyze-bundle.mjs` — Generates `metafile.json` for esbuild bundle analysis.
- `run-jest.js` — Required Jest wrapper; supplies Node `--localstorage-file` isolation.
- `sync-version.js` — Syncs `package.json` version into `manifest.json` and `versions.json`.
- `postinstall.mjs` — Creates `.env.local` from example outside CI when missing.

## Gotchas

- Do not bypass `run-jest.js` for normal test runs; direct Jest may use different localStorage behavior.
- `build-css.mjs` intentionally fails if a CSS file under `src/style/` is not imported by `src/style/index.css`.
- Release workflows upload only `main.js`, `manifest.json`, and `styles.css`.
