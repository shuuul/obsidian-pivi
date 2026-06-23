# Bundle size analysis — obsius2

> **Date:** 2026-05-25  
> **Command:** `npm run analyze:bundle` → `metafile.json`  
> **Visualizer:** https://esbuild.github.io/analyze/ (upload `metafile.json`)

## Summary

| Metric | Before (2026-05-25) | After dedupe (i18n bundled) |
|--------|---------------------|-----------------------------|
| Minified `main.js` (analyze build) | **6.48 MB** | **~4.5 MB** (see latest `npm run analyze:bundle`) |
| `pi-coding-agent` nested deps in bundle | **~2.45 MB (~38%)** | **~0.54 MB (~12%)** |
| i18n locale JSON in bundle | **~149 KB** | **~149 KB** (all locales static-imported) |
| Obsius `src/` (excl. i18n) | **~713 KB (~11%)** | similar |

**Deploy layout:** `main.js`, `manifest.json`, `styles.css` only (community install standard).

The plugin bundle is dominated by **Pi stack + provider SDKs**, not Obsius feature code. The largest win was **esbuild hoisting** bare imports from `pi-coding-agent/node_modules` to project root (see `esbuild.config.mjs` `dedupe-pi-coding-agent-nested` plugin).

## Top contributors (single files)

| Size | Module | Notes |
|------|--------|--------|
| ~289 KB ×2 | `@earendil-works/pi-ai/dist/models.generated.js` | Model catalog; appears **twice** (root + nested under `pi-coding-agent`) |
| ~279 KB ×2 | `@google/genai/dist/node/index.mjs` | Google provider; duplicated nested tree |
| ~61 KB ×2 | `web-streams-polyfill` | Duplicated |
| ~49 KB ×2 | `zod/v3/types.js` | Duplicated |
| ~36 KB | `src/i18n/locales/ru.json` | Largest locale file |
| ~26 KB | `InputController.ts` | Largest Obsius TS module |

## By package (aggregated `bytesInOutput`)

| Package | ~Share |
|---------|--------|
| `@earendil-works/pi-coding-agent` | 2.47 MB |
| `zod` | 0.79 MB |
| `@mistralai/mistralai` | 0.48 MB |
| `@earendil-works/pi-ai` | 0.41 MB |
| `typebox` | 0.30 MB |
| `@google/genai` | 0.27 MB |
| `@modelcontextprotocol/sdk` | 0.23 MB |
| Obsius `src/` (all) | 0.71 MB |

## Root cause: duplicate dependency trees

`pi-coding-agent` ships its own `node_modules` copy of `pi-ai`, `zod`, `@google/genai`, etc. Esbuild traces **both** the plugin’s top-level installs and the nested copies, so many modules appear **2×** in the graph (~2.45 MB nested-only overhead).

This is an **npm layout / bundler resolution** issue, not dead code in Obsius.

## Obsius `src/` breakdown

- **Chat UI/controllers** — `InputController`, `StreamController`, `InputToolbar`, `ToolCallRenderer`, `SubagentManager` (~100+ KB combined).
- **i18n** — six locale JSON files (~149 KB); all bundled eagerly via static imports.
- **Pi adaptor** — runtime, MCP, tools, settings modules (remainder).

## Recommendations (prioritized)

### 1. Dedupe nested `pi-coding-agent` deps — **done (2026-05-25)**

- `package.json` `overrides` for `@earendil-works/pi-ai` / `pi-agent-core`.
- Esbuild plugin `dedupe-pi-coding-agent-nested`: bare imports from nested `node_modules` resolve to project root (relative imports stay in nested package).
- Result: **6.48 MB → 4.44 MB** analyze build.

### 2. i18n — **bundled in main.js**

- All `src/i18n/locales/*.json` are static-imported (no external `locales/` folder). Matches Obsidian community install (three files only).

### 3. Do **not** expect big wins from splitting Obsius files

- File splits (e.g. `StreamController`) improve maintainability; they do not remove bytes from the bundle unless imports become conditional.

### 4. Dynamic import of Pi subsystems (product decision)

- Defer loading `pi-coding-agent` skills/MCP-heavy paths until first use.
- Requires async bootstrap in `main.ts` and UX for “agent warming up” — coordinate with ADR if pursued.

### 5. Provider SDK pruning — **unblocked by pi-ai 0.80.x**

`pi-ai@0.80.x` supports explicit `Models` collections and per-provider factory imports. Obsius currently keeps compatibility behavior by using `builtinModels()` (all providers). To reduce bundle size, select a smaller provider set and switch `src/pi/piAiModels.ts` to `createModels()` plus only those provider factories.

Selection tracker: [pi-ai-provider-selection.md](./pi-ai-provider-selection.md).

## Regenerate

```bash
npm run analyze:bundle
# Open metafile.json at https://esbuild.github.io/analyze/
```

Add `metafile.json` to `.gitignore` if committing the analyze output becomes noisy (optional).

## Related

- [quality-backlog.md](./quality-backlog.md) — P2 #21 analyze script
- [quality-review.md](../quality-review.md) — original 6.5 MB finding
