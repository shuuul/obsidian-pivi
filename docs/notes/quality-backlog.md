# Quality hardening backlog

> Tracking doc for [quality-review.md](../quality-review.md) (2026-05-25 audit).  
> **Status:** P0–P3 items addressed in-repo; see git history for PR-sized chunks.

## Done (2026-05-25)

| ID | Item |
|----|------|
| P0 1–5 | ESLint `no-explicit-any` warn, `no-console`, silent catch logging, settings JSON guard, dead exports removed |
| P1 9–12 | `textResult`, `legacySseTransport`, `extractTextContent`, `resolvePiModelFromKey` |
| P1 6–8, 13 | Tests: main lifecycle, ChatState, utils, helpers; `no-console` rule |
| P2 14–17 | `createObsidianTools` split, `PiModelsSettingsSection` split, dropdown-list CSS, inline-edit `!important` 18→5 |
| P2 18–19 | CSS prod minify; removed `jest-environment-jsdom` |
| P2 20–24 | `openAuthUrl` errors, bundle analyze script, ESLint complexity warns, shared test helpers |
| P3 28–35 | backdrop-filter fallbacks, spacing tokens, `setTimeout` in MCP CLI paths, test timeout, skills SVG via DOM |
| Follow-up | [bundle-analysis.md](./bundle-analysis.md); `src/pi/ui/` `no-explicit-any` cleared (`PiCachedModel`) |
| Bundle opt | Dedupe plugin: **6.48 MB → ~4.5 MB**; i18n stays in bundle (no external `locales/`) |

## Deferred (documented rationale)

| Item | Why not now |
|------|-------------|
| **dist/ output** (P3 #25) | Obsidian community plugins require `main.js` at plugin root; `dist/` would break deploy copy path. |
| **6 no-op ChatRuntime callbacks** (P2) | Port contract for future Pi features; removing breaks `features/` compile-time API. Documented on `PiChatRuntime`. |
| **Zod tool validation** (P3 #31) | Large scope; obsidian tools spec already documents shapes. Revisit when splitting tools further. |
| **Further bundle reduction** | See [bundle-analysis.md](./bundle-analysis.md); nested Pi deps were deduped (**6.48 MB → ~4.5 MB**) and i18n intentionally stays bundled for the three-file Obsidian community plugin layout. Remaining high-ROI levers are dynamic import of Pi-heavy subsystems and refreshed provider-SDK measurements. |
| **SubagentManager full coverage** | 1100+ lines, DOM + runtime; basic lifecycle tests added; full suite needs StreamController-style fixtures. |
| **StreamController queue extract** | `StreamRenderQueue` added; full StreamController migration optional follow-up. |
| **Responsive `@media`** | Obsidian sidebar has fixed width; low ROI until mobile layout is a product goal. |

## Commands

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run analyze:bundle   # writes metafile.json for esbuild analyze UI
```
