---
id: "058"
title: "Simplification follow-up"
status: Completed
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
- [x] One-time migrations for formats that shipped in 0.15.0 or earlier are removed; steady-state load paths and old-session read compatibility are unchanged.
- [x] Root `AGENTS.md` holds operational rules only; architecture narrative lives in `docs/`.
- [x] The local CI-equivalent quality gate is green after each workstream.

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
| 2026-10-04 | Keep the MCP load-time rewrites of plaintext `bearerToken` / `oauth.clientSecret` and plain header maps. | `.pivi/mcp.json` is user-editable and synced. These rewrites run on every load and move any plaintext secret that appears in the file into `SecretStorage`, so they are input hygiene for hand-edited or pasted configs, not only a version migration. | WS-04 |
| 2026-10-04 | Keep the command-removal transaction deleting a same-id file in `.pivi/templates/`. | The eager move leaves a template in place when a command of the same id already exists; removing only the canonical file would let the next startup move the shadowed template in and resurrect the command. | WS-04 |
| 2026-10-04 | Move `.pivi/templates/` commands eagerly before removing the dual read. | That path migrates only when a command is edited, so unedited old commands still depend on it. | WS-04 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Remove test-only exports and their tests | Claude Code | Done | None | Full quality gate |
| WS-02 | Archive spec 056, remove `nodeFetch.ts` and retired-name guards | Claude Code | Done | None | Full quality gate |
| WS-03 | Remove ESLint import-ban blocks duplicated by the architecture script | Claude Code | Done | None | Full quality gate; every removed ESLint ban maps to a script rule |
| WS-04 | Remove one-time migrations for formats shipped in 0.15.0 or earlier | Claude Code | Done | WS-03 | Full quality gate; per-migration evidence of the shipping release |
| WS-05 | Reorganize `AGENTS.md` guidance and move architecture narrative to `docs/` | Claude Code | Done | WS-03, WS-04 | `npm run check:boundaries` (docs contracts, README coverage) |

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

### 2026-10-04 — Claude Code — WS-04 (continued)

- Changed, each verified against its introducing commit before removal:
  - Small paths: tab-manager `data.json` fallback (`46d30e67`, 0.6.0; `b4e20765`, 0.7.0); web-search settings shape (`443bdd96`, 0.10.0); web-search keys in the provider credential store (`031aa6a7`, 0.3.11); vault-root skills CLI metadata (`6e02bf8f`, ≤0.3.0); `agentState.piSessionFile` (`57085632`, ≤0.3.0); `effortLevel` fallback.
  - Credentials: legacy per-kind and `credential-v2` secret readers; the split-plan Grok/Claude OAuth namespace migration and `membershipAwareCredentialMigration.ts`; the every-startup `migrateProviderSecretsToKeychain` call. `migratePiProviderCredentialsToKeychain` now only hands environment-text credentials to the keychain, for bulk import.
  - Provider cutover: the legacy branch of `runDeviceLocalProviderMigration`, `customProviderHeaderMigration.ts`, the plaintext `.pivi/mcp-oauth/` migration (`mcpAuthEntryMigration.ts`, `legacyVaultAuthEntry.ts`), and all of `legacyProviderSnapshot.ts` except `hasLegacyProviderFields`.
  - Environment cutover: the legacy branch of `runDeviceLocalEnvironmentMigration` (`d274b8e0`, 0.15.0).
- Behavior for a device with no local state: provider and environment fields found in synced settings are stripped, not migrated; defaults are seeded.
- Evidence: full quality gate green (376 suites, 3356 tests); `main.js` 4,205,349 bytes.
- Remaining within the 0.15.0 cutoff: `.pivi/templates/` commands (add an eager move first); session index sidecar relocation (the legacy path is also the unit-test fallback); MCP plaintext bearer/client-secret and plain header-map rewrites (partly live code). The functions and files still named `…Migration` are now startup loaders; renaming is deferred to keep this change reviewable.
- Blockers: None.
- Next action: maintainer review of the removed startup behavior, then the three remaining items.

### 2026-10-04 — Claude Code — WS-04 (final)

- Changed:
  - `.pivi/templates/`: `PiSlashCommandCatalog.prepareWorkspace` now moves template commands into `.pivi/commands/` once, under the mutation lock, skipping ids that already exist there. The catalog scan, upsert, and rename paths no longer read the templates folder, and the `legacy-template:` persistence key is gone. The dual read dated from `00b89a72` (0.3.1).
  - Session index sidecar: removed `migrateLegacySessionJsonlIndex` and the legacy-sidecar cleanup on rebuild and invalidate (`2ce349fb`, 0.15.0). The colocated path remains only as the default when no index root is configured, which unit tests rely on. Stale `.pivi-index` files beside old sessions are no longer deleted; indexes are rebuildable, so nothing is lost.
  - MCP plaintext and plain-header rewrites: evaluated and kept; see Decisions.
- Evidence: full quality gate green.
- Remaining: None for WS-04. Functions and files named `…Migration` that are now startup loaders have not been renamed.
- Blockers: None.
- Next action: WS-05.

### 2026-10-04 — Claude Code — WS-05 (root guidance and loader renames)

- Changed:
  - Root `AGENTS.md`: moved the Architecture Status paragraphs and the four module maps verbatim into the new `docs/12-architecture-status.md`, left a six-bullet architecture summary with a link, and collapsed rules that were repeated inside the file (the PR-gate command, the rendered-CSS sign-off, the Pi dependency boundary). Size 62.5 KB → 40.6 KB. The glossary, commands, quality gates, coding standards, and release procedure are unchanged.
  - Renamed the startup loaders that were still called migrations: `deviceLocalProviderMigration.ts` → `deviceLocalProviderLoad.ts` (`loadDeviceLocalProviderState`), `deviceLocalEnvironmentMigration.ts` → `deviceLocalEnvironmentLoad.ts` (`loadDeviceLocalEnvironmentState`, `handOffCanonicalCredentialsFromText`), `legacyProviderSnapshot.ts` → `syncedProviderFields.ts` (`hasSyncedProviderFields`), and `migratePiProviderCredentialsToKeychain` → `movePiProviderCredentialsFromEnvironment`. The unused `cutoverPerformed` result flag became `seededDefaults` / `seededEmpty`.
- Evidence: full quality gate green; docs-contract and README-coverage checks pass with the new page indexed in `docs/README.md`.
- Remaining: `src/app/AGENTS.md` (about 31 KB), `packages/agent/AGENTS.md` (about 24 KB), and `scripts/AGENTS.md` (about 15 KB) are untouched. They hold local invariants mixed with narrative; trimming them needs a rule-by-rule pass rather than a move.
- Blockers: None.
- Next action: maintainer decision on whether to trim the per-directory files.

### 2026-10-04 — Claude Code — WS-05 (per-directory guidance and staleness audit)

- Changed:
  - Trimmed `scripts/AGENTS.md` (15 KB → 9 KB), `packages/agent/AGENTS.md` (24 KB → 9 KB), and `src/app/AGENTS.md` (31 KB → 18 KB). Each now holds grouped rules, a directory or file map, and gotchas. The long behavior paragraphs of the agent and app files were moved verbatim, with stale details corrected, into `docs/12-architecture-status.md` ("Agent package subsystem notes", "App composition notes").
  - Audited every `AGENTS.md`, every `docs/` page, and the package READMEs against the code. A script checked that each backticked path, `@pivi/*` subpath, symbol, and npm script exists; three read-only subagent audits checked behavior and enforcement claims. Their findings were spot-checked and about sixty statements were corrected.
  - Corrections that predate this work: stdio MCP entries are skipped on load, not rejected; there is no selected-text toolbar provider selector; destructive settings actions use the inline two-press button, not `ModalLayer`; `check:package-readmes` checks section headings only; `check-pi-pins` and the canary cover four Pi packages; the build has no nested-shrinkwrap or `#` alias handling; several test paths and a CSS manifest count were wrong.
  - Removed a dead architecture-rule pattern for the nonexistent `@pivi/agent/engine` subpath.
- Evidence: full quality gate green; docs-contract and README-coverage checks pass.
- Not verified: prose describing runtime behavior that does not reduce to a symbol, constant, or file (for example IME ordering, compaction pass details, unload internals, CSS layout claims). The audits confirmed the named symbols exist but did not trace those behaviors.
- Blockers: None.
- Next action: maintainer review, then close out this spec.

## Completion summary

All five workstreams are done.

Delivered:

- Thirty exports that only tests exercised are removed with their tests.
- Import boundaries are enforced only by `scripts/check-architecture-boundaries.mjs`. A probe of 147 ESLint ban samples found the script's gaps, which were closed before the ESLint blocks were deleted.
- Startup runs no settings, credential, provider-registry, environment, or MCP OAuth migration for formats older than 0.15.0. On a device with no local state the loaders seed defaults and strip synced fields. The loaders were renamed from `…Migration` to `…Load`.
- Root `AGENTS.md` shrank from 62.5 KB to about 41 KB and three per-directory files were trimmed; their narrative moved to `docs/12-architecture-status.md`. Every `AGENTS.md`, handbook page, and package README was audited and about sixty stale statements were corrected.

Deviations from the original scope:

- The MCP load-time rewrites of plaintext secrets and plain header maps were kept as input hygiene for a user-editable synced file.
- `.pivi/templates/` gained a one-time eager move instead of a plain deletion, and command removal still deletes a same-id template.
- The colocated session-index path remains as the default when no index root is configured, for unit tests.
- About thirty barrel re-exports that only tests import were left in place.

Not verified: documentation prose about runtime behavior that does not reduce to a symbol, constant, or file. The removed startup migrations were verified against their introducing commits but not against real pre-0.15.0 user data.

Release note required: the next minor supports upgrades from 0.15.0 or later. Users on older versions must upgrade to an intermediate release first, or provider configuration and environment variables reset and credentials must be re-entered.

Verification: the local CI-equivalent quality gate was green after every workstream.
