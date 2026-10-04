---
id: "058"
title: "Simplification follow-up"
status: Active
created: 2026-10-04
updated: 2026-10-04
coordinator: "Claude Code"
---

# 058 — Simplification follow-up

## Context

Spec 057 removed portability abstractions. A follow-up audit found further simplification targets that are unrelated to portability:

- Thirty exported symbols were reachable only from tests.
- Import bans are enforced twice: by ESLint `no-restricted-imports` and by `scripts/check-architecture-boundaries.mjs`. The script also covers dynamic `import()`, `require`, re-exports, and relative-path resolution, which ESLint does not, so ESLint is the weaker copy.
- Startup still runs one-time storage and credential migrations for formats that shipped in 0.15.0 (2026-07-23) or earlier.
- Nineteen `AGENTS.md` files total about 340 KB; root `AGENTS.md` alone is about 62 KB and repeats material held in `src/app/AGENTS.md` and `docs/`.

## Goal and success criteria

Reduce code, checks, and guidance that no longer earn their maintenance cost, without changing behavior for users upgrading from 0.15.0 or later.

- [x] No exported symbol is kept alive only by tests, apart from documented test seams.
- [x] Each import ban has one enforcement mechanism.
- [ ] One-time migrations for formats that shipped in 0.15.0 or earlier are removed; steady-state load paths and old-session read compatibility are unchanged.
- [ ] Root `AGENTS.md` holds operational rules only; architecture narrative lives in `docs/`.
- [ ] The local CI-equivalent quality gate is green after each workstream.

## Scope and non-goals

In scope:

- Test-only exports, the duplicated import-ban enforcement, pre-0.15.0 one-time migrations, and guidance layout.

Not in scope:

- Backward-compatible read paths for durable session data (external-context stripping in session JSONL, tool-name aliases for old transcripts, Pi session file versions). A version cutoff does not make these safe to delete.
- Migrations whose new format shipped after 0.15.0 (capability-permission records, MCP secret-ID rename, legacy SSE rewrite).
- Any rendered-CSS change.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-10-04 | Keep the architecture script for import bans and delete the ESLint duplicates. | The script covers dynamic imports, `require`, re-exports, and relative paths; ESLint matches static specifier strings only. Cost: violations surface at pre-commit and CI rather than in the editor. | WS-03 |
| 2026-10-04 | The next minor release supports upgrades from 0.15.0 or later only. | Maintainer decision. Users on older versions must first upgrade to an intermediate release; otherwise provider configuration and environment variables reset silently and credentials must be re-entered. Release notes must say so. | WS-04 |
| 2026-10-04 | Keep the steady-state branches of `runDeviceLocalProviderMigration`, `runDeviceLocalEnvironmentMigration`, and `overlayDeviceLocalCapabilityPermissions`. | They seed fresh installs and overlay device-local state on every startup; only their legacy branches are migrations. | WS-04 |
| 2026-10-04 | Move `.pivi/templates/` commands eagerly before removing the dual read. | That path migrates only when a command is edited, so unedited old commands still depend on it. | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Remove test-only exports and their tests | Claude Code | Done | None | Full quality gate |
| WS-02 | Archive spec 056, remove `nodeFetch.ts` and retired-name guards | Claude Code | Done | None | Full quality gate |
| WS-03 | Remove ESLint import-ban blocks duplicated by the architecture script | Claude Code | Done | None | Full quality gate; every removed ESLint ban maps to a script rule |
| WS-04 | Remove one-time migrations for formats shipped in 0.15.0 or earlier | Claude Code | In progress | WS-03 | Full quality gate; per-migration evidence of the shipping release |
| WS-05 | Reorganize `AGENTS.md` guidance and move architecture narrative to `docs/` | Unassigned | Pending | WS-03, WS-04 | `npm run check:boundaries` (docs contracts, README coverage) |

## Verification

- `npm run check:dependencies && npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size` after each workstream.
- `npm run build && obsidian plugin:reload id=pivi`, then `obsidian dev:errors` reports no errors.
- WS-04: for each removed migration, record the commit and release in which the new format shipped; run the device-local provider and environment acceptance tests for a fresh install and for an already-migrated device.
- `npm run check:specs` before closeout.

## Documentation sync

- Numbered developer docs: `docs/10-roadmap-release-and-maintenance.md` for the upgrade-from policy; architecture pages for WS-05.
- Nearest local guidance: `src/app/AGENTS.md`, `scripts/AGENTS.md`, `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`, `packages/obsidian-host/AGENTS.md`.
- Parent/package guidance: package READMEs touched by removed migrations.
- Root guidance and roadmap: `AGENTS.md`; `CHANGELOG.md` entry for the upgrade-from policy in the release commit.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-10-04 — Claude Code — WS-01, WS-02

- Changed: removed thirty test-only exports with their tests and two dead i18n keys; retargeted egress-policy and vault-edit tests at the production functions; archived spec 056; deleted `nodeFetch.ts` and the retired package-name guards.
- Evidence: commit `4a7c784a`; full quality gate green (379 suites, 3407 tests).
- Remaining: about thirty redundant barrel re-exports that only tests import were left in place.
- Blockers: None.
- Next action: WS-03.

### 2026-10-04 — Claude Code — WS-03

- Changed: removed fourteen ESLint `no-restricted-imports` blocks and their shared pattern constants (`eslint.config.mjs` 568 → 209 lines). Before removal, a probe wrote one fixture import per ESLint pattern (147 probes) and ran the architecture script on each; 115 were already rejected. The real gaps were added to the script: raw Pi SDK imports from `src` and `@pivi/obsidian-host`, `obsidian/*` and `electron/*` subpath forms, any `node:` builtin in agent settings, self-referencing `@pivi/agent` imports, and `pi-mcp` imports outside `packages/agent/src/mcp`. The remaining probe misses were artifacts (a bare `src` specifier and negated patterns).
- Evidence: architecture check passes on the repository; lint passes.
- Remaining: None.
- Blockers: None.
- Next action: WS-04.

### 2026-10-04 — Claude Code — WS-04 (partial)

- Changed: removed the Codex `.pivi/auth.json` → SecretStorage migration: `ProviderLegacyAuthStore` / `ProviderLegacyAuthData` ports, `providerLegacyAuthStore.ts`, the legacy read/clear paths in `ProviderOAuthService`, its constructor parameter, and three tests. SecretStorage for Codex OAuth shipped in `0f8a16a5` (2026-06-24), before the first local tag 0.3.0.
- Evidence: full quality gate green (378 suites, 3402 tests); plugin reloaded with no captured errors.
- Remaining, each to be verified against its introducing release before removal: tab-manager state `data.json` fallback (0.6.0/0.7.0); web-search settings shape (0.10.0); web-search keys from the provider credential store (0.3.11); skills CLI metadata at vault root (≤0.3.0); `agentState.piSessionFile` (≤0.3.0); `effortLevel` fallback (≤0.3.0); provider credential legacy secret-ID readers (0.3.2); split-plan OAuth namespace migration (0.11.0); plaintext `.pivi/mcp-oauth/` (0.13.1); provider registry and custom-provider header cutover legacy branches (0.13.1); environment cutover legacy branch (0.15.0); session index sidecar relocation (0.15.0, also the unit-test fallback path); MCP plaintext bearer/client-secret and plain header-map rewrites (partly live code); `.pivi/templates/` commands (needs an eager move first).
- Blockers: None.
- Next action: continue row by row, smallest and most isolated first; the provider and environment cutover branches last.

## Completion summary

Pending.
