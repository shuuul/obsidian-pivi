---
id: "057"
title: "Drop portability abstractions"
status: Active
created: 2026-10-04
updated: 2026-10-04
coordinator: "Claude Code"
---

# 057 — Drop portability abstractions

## Context

Pivi's architecture was shaped by two goals that no longer apply: running on more than one agent runtime, and embedding the product in a host other than Obsidian. The maintainer has decided that Pivi targets Pi only and Obsidian only.

Repository evidence of abstractions that exist only for those goals:

- `@pivi/pivi-react` received an injected `PresentationPlatform` whose terminology table returned `Obsidian` for every locale and whose two other methods wrapped `setIcon` / `setTooltip`.
- `src/ui` could import `obsidian` but not `@pivi/obsidian-host`, so `src/app/hostPlatform.ts` re-exported path helpers.
- `@pivi/agent` declares 133 subpath exports, 122 of which map one file to one export; `@pivi/engine-pi` declares 47 and `@pivi/obsidian-host` 20. The architecture check rejects wildcard exports.
- `ChatPorts`, `SettingsPorts`, four facade types, and two host contracts separate port ownership between packages mainly so presentation and runtime could move independently of the host.
- `@pivi/agent/ports` and the "host-neutral" rules keep Obsidian knowledge out of the agent package although each port has one production implementation.

The Pi SDK boundary in `@pivi/engine-pi` and the `pi-mcp` boundary in `packages/agent/src/mcp` are not portability abstractions. They contain upstream churn (the 1.0.1 and 1.0.2 upgrades touched only those areas) and stay.

## Goal and success criteria

Remove abstractions whose only purpose is host or runtime portability, without changing user-visible behavior.

- [x] React presentation calls the `obsidian` API directly and has no injected platform or terminology placeholders; rendered copy is byte-identical per locale.
- [x] `src/ui` imports host helpers from `@pivi/obsidian-host` directly and `src/app/hostPlatform.ts` no longer exists.
- [x] Workspace packages whose exports map one file to one subpath use a wildcard export, and the architecture check no longer requires explicit per-file exports.
- [x] UI port layering is reduced to the seams that carry test or snapshot-isolation value.
- [ ] `@pivi/agent` guidance and checks no longer state host neutrality as a goal; ports that only serve it are removed.
- [ ] The local CI-equivalent quality gate is green after each workstream.

## Scope and non-goals

In scope:

- Presentation platform, host terminology, and `hostPlatform` indirection.
- Package export surfaces and the architecture rules that enforce them.
- UI port and facade layering in `src/app` and `src/ui`.
- Host-neutral framing of `@pivi/agent` in code, checks, and guidance.

Not in scope:

- The `@pivi/engine-pi` Pi SDK boundary, `ToolSpec`, `PiChatService`, and the `pi-mcp` import boundary.
- Merging or renaming workspace packages.
- Renaming `workspace` / `secureStorage` identifiers or `--pivi-host-*` CSS tokens; the churn outweighs the benefit.
- Any rendered-CSS change.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-10-04 | Pivi targets Pi and Obsidian only; portability is not a design goal. | Maintainer decision. | All |
| 2026-10-04 | Keep the Pi SDK and `pi-mcp` import boundaries. | They isolate upstream churn; recent Pi upgrades stayed inside them. | WS-03, WS-05 |
| 2026-10-04 | Inline host terminology with the exact values the Obsidian adapter supplied. | Keeps rendered copy unchanged in all ten locales. | WS-01 |
| 2026-10-04 | Keep product-owned `pivi-*` CSS class rules. | They protect styling isolation from Obsidian theme classes, independent of portability. | WS-01 |
| 2026-10-04 | Use a wildcard leaf export for `@pivi/agent`, `@pivi/engine-pi`, and `@pivi/obsidian-host`; keep directory barrels explicit. | Nearly every file is already exported one-to-one, so the list records nothing. `check:dead-code` still rejects unused exports. | WS-03 |
| 2026-10-04 | Set knip `includeEntryExports` for the three wildcard packages and `ignore` build-consumed shims. | A wildcard export makes every file a knip entry, which hid unused exports. Checking entry exports is stricter than the previous explicit list, which hid 222 unused exports. | WS-03 |
| 2026-10-04 | Keep `PiviUiFacades` and `ChatUIConfig` as the injected model/settings seam. | About ten test files inject fake model and reasoning behavior through `getUiFacades()`; calling the engine directly would replace object injection with module mocks. Only members with no production behavior are removed. | WS-04 |
| 2026-10-04 | Keep `@pivi/pivi-react` exports explicit. | Its seven barrels are a curated surface that other rules depend on. | WS-03 |

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Remove `PresentationPlatform` and host terminology placeholders | Claude Code | Done | None | Full quality gate; human check of icons and tooltips |
| WS-02 | Remove `src/app/hostPlatform.ts` and the `src/ui` host-package ban | Claude Code | Done | None | Full quality gate |
| WS-03 | Wildcard leaf exports and removal of explicit-export rules | Claude Code | Done | None | Full quality gate; production build resolves every subpath |
| WS-04 | Reduce UI port and facade layering | Claude Code | Done | WS-03 | Full quality gate |
| WS-05 | Remove host-neutral framing and single-purpose ports from `@pivi/agent` | Unassigned | Pending | WS-03 | Full quality gate |

## Verification

- `npm run check:dependencies && npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size` after each workstream.
- `npm run build && obsidian plugin:reload id=pivi`, then `obsidian dev:errors` reports no errors.
- `npm run check:specs` before closeout.
- WS-01 human check (no CSS changed, but the icon and tooltip call path did): chat tab bar, send button, selection toolbar, inline edit controls, and settings pages show icons and tooltips as before.

## Documentation sync

- Numbered developer docs: `docs/08-presentation-and-settings.md` updated for WS-01; revisit `docs/` architecture pages in WS-04 and WS-05.
- Nearest local guidance: `packages/pivi-react/AGENTS.md`, `packages/pivi-react/src/i18n/AGENTS.md`, `src/app/AGENTS.md`, `src/ui/AGENTS.md`, `src/ui/chat/AGENTS.md`, `src/ui/shared/AGENTS.md`, `scripts/AGENTS.md`.
- Parent/package guidance: `packages/agent/AGENTS.md`, `packages/engine-pi/AGENTS.md`, `packages/obsidian-host/AGENTS.md` for WS-03 and WS-05.
- Root guidance and roadmap: `AGENTS.md` architecture status, module map, and coding standards.

## Progress and handoff

Append entries rather than rewriting another agent's record.

### 2026-10-04 — Claude Code — WS-01, WS-02

- Changed: removed `PresentationPlatform`, `HostTerminology`, and `src/app/hostPlatform.ts`; inlined terminology into all locale catalogs; added `src/app/slashBadgeNavigation.ts`; removed three host-neutral architecture rules and the React `obsidian` import ban.
- Evidence: commit `393b0082`; full quality gate green; plugin reloaded with no captured errors.
- Remaining: human check of icons and tooltips.
- Blockers: None.
- Next action: WS-03.

### 2026-10-04 — Claude Code — WS-03

- Changed: `@pivi/agent`, `@pivi/engine-pi`, and `@pivi/obsidian-host` keep directory barrels explicit and expose other files through `./*` (185 export lines removed); removed the explicit-exports architecture rule and its tests; knip now checks entry-file exports for those packages and ignores build-consumed shims; removed 222 unused exports the explicit list had hidden, plus the dead code they exposed (`nodeFetch`, `createNodeFetch`, `BASH_CLASSIFIER_VERSION`, `LIVE_GENERIC_TOOLS`).
- Evidence: full quality gate green (381 suites, 3459 tests); `main.js` 4,221,389 bytes; plugin reloaded with no captured errors.
- Remaining: WS-04 and WS-05.
- Blockers: None.
- Next action: WS-04 needs a decision on which UI port seams to keep before implementation.

### 2026-10-04 — Maintainer — WS-01

- Changed: None.
- Evidence: maintainer inspected icons and tooltips in the reloaded Obsidian UI and found no problems.
- Remaining: None for WS-01.
- Blockers: None.
- Next action: WS-04 scope decision.

### 2026-10-04 — Claude Code — WS-04

- Changed: `ApplicationSessions` implements `ChatSessionPort` with the port's method names, removing `SessionsFacade` and the fourteen forwarding lambdas; `ChatFacade`, `WorkspaceFacade`, `IntegrationsFacade`, `SettingsFacade`, `PiviApplicationFacades`, and `ui/chatUiCompositionHost.ts` are merged into `PiviChatCompositionHost` and `PiviSettingsHost`; `PiviApplication.facades` is gone. Removed members with no production behavior: `prepareModelMetadata` (never implemented by the Pi config), the always-empty `invalidatedSessions` result and its two consumer loops, the `persistSessionSummary` environment hook, and the static `PiSettingsCoordinator` class (now three functions).
- Evidence: full quality gate green (381 suites, 3455 tests); `main.js` 4,219,406 bytes; plugin reloaded with no captured errors.
- Remaining: `ChatIconSvg` still carries `path` and `composite` kinds although the only producer returns the Pivi brand icon; `ChatUIConfig` still takes untyped settings bags. Both are candidates for WS-05.
- Blockers: None.
- Next action: WS-05.

## Completion summary

Pending.
