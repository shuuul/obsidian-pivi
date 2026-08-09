---
id: "043"
title: "Agent package split"
status: Completed
created: 2026-08-10
updated: 2026-08-10
coordinator: "Cursor agent"
---

# 043 — Agent package split

## Context

`@pivi/pivi-agent-core` was a fat aggregate that mixed host-neutral contracts with the Pi SDK adapter under `src/engine/pi/`. Directory-level architecture checks already quarantined `@earendil-works/*` to that folder, but the same package still declared Pi dependencies and relative paths could still reach the adapter. The name also collided cognitively with `@earendil-works/pi-agent-core`.

## Goal and success criteria

Rename the host-neutral package to `@pivi/agent` and extract `@pivi/engine-pi` as the sole Pi adapter package, with CI-enforced package boundaries and no old-name compatibility layer.

- [x] `@pivi/pivi-agent-core` and `packages/pivi-agent-core` are gone; no re-export alias remains.
- [x] `@pivi/agent` has no `@earendil-works/*` or `@pivi/engine-pi` dependencies.
- [x] `@pivi/engine-pi` owns all former `engine/pi` sources and the three exact Pi pins.
- [x] Only `src/app/**` / `src/main.ts` (and tests) import `@pivi/engine-pi`; UI/host/tools/react use `@pivi/agent` only.
- [x] `npm run typecheck && npm run lint && npm run check:boundaries && npm run test && npm run build && npm run check:bundle-size` pass.
- [x] Handbook and nearest `AGENTS.md` files describe the new package map.

## Scope and non-goals

In scope:

- Physical rename/split, import rewrites, export whitelist, architecture/ESLint enforcement, docs sync.

Not in scope:

- StreamFn-style abstraction inside engine-pi away from pi-ai.
- Compatibility re-exports of `@pivi/pivi-agent-core`.
- User-visible runtime/UI/CSS/i18n behavior changes.
- Collapsing app composition leaves into a mega-facade.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-08-10 | Packages are `@pivi/agent` and `@pivi/engine-pi` | Honest host-neutral vs Pi-adapter identities; avoids upstream name collision | WS-01–WS-05 |
| 2026-08-10 | No old-name compatibility layer | Forward-only; compatibility would keep the fat-package confusion | WS-02 |
| 2026-08-10 | Only `src/app` + `src/main.ts` (+ tests) may import engine-pi | Composition owns concrete Pi construction; product UI stays on contracts | WS-04 |
| 2026-08-10 | engine-pi exports are whitelisted (no full wildcard) | Tightens public surface after the package boundary exists | WS-03 |
| 2026-08-10 | Construction subagents use `cursor-grok-4.5-high-fast` | Plan execution rule for parallel mechanical work | All |
| 2026-08-10 | ESLint bans exact `@pivi/agent` root via regex | `group: ["@pivi/agent"]` falsely matched subpaths after the shorter rename | WS-04 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Physical rename + engine-pi extract | Coordinator | Done | None | Packages exist; Pi deps only on engine-pi |
| WS-02 | Repo-wide import + tooling path rewrite | Coordinator + subagents | Done | WS-01 | No old package imports remain |
| WS-03 | Export whitelist for engine-pi; agent has no Pi surface | Coordinator | Done | WS-02 | check:boundaries exports gate |
| WS-04 | Architecture + ESLint boundary hardening | Subagents + coordinator | Done | WS-01 | check:boundaries + lint |
| WS-05 | Docs / AGENTS sync | Subagents | Done | WS-01 | Docs describe new map |
| WS-06 | Quality gates + archive | Coordinator | Done | WS-01–WS-05 | Full gate command set |

## Verification

```bash
npm run check:specs
npm run typecheck
npm run lint
npm run check:boundaries
npm run test
npm run build
npm run check:bundle-size
```

Evidence (2026-08-10): all of the above passed. Tests: 330 suites / 2817 tests. `check:bundle-size` under 5 MB hard ceiling (warning only vs soft baseline).

## Documentation sync

- Numbered developer docs: `docs/01-getting-started.md`, `docs/02-architecture-and-technology.md`, `docs/README.md`, and path references in `docs/07`, `docs/09`.
- Nearest local guidance: `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`.
- Parent/package guidance: `src/app`, `src/ui`, `pivi-react`, `obsidian-host`, `obsidian-tools`, `tests`, `scripts`.
- Root guidance: `AGENTS.md`.

## Progress and handoff

### 2026-08-10 — Coordinator — WS-01–WS-06

- Changed: Renamed to `@pivi/agent`, extracted `@pivi/engine-pi`, rewrote imports/tooling, hardened checkers, synced docs, passed quality gates.
- Evidence: Gate command set green; this completion summary.
- Remaining: None.
- Blockers: None.
- Next action: Archive.

## Completion summary

Delivered `@pivi/agent` (host-neutral, no Pi SDK deps) and `@pivi/engine-pi` (sole `@earendil-works/*` owner). Old `@pivi/pivi-agent-core` identity removed with no compatibility layer. Architecture/ESLint enforce agent↛engine-pi and composition-only engine imports (`src/app` + `src/main.ts`). Handbook and package AGENTS/READMEs describe the new map. Soft bundle-size baseline warning remains (3.77 MB vs 2.82 MB baseline) but the 5 MB hard ceiling passes.
