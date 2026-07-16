---
id: "014"
title: "Obsidian review hardening"
status: Completed
created: 2026-07-17
updated: 2026-07-17
coordinator: "/root"
---

# 014 — Obsidian review hardening

## Context

Obsidian review reported direct DOM construction, missing 1.13 settings search definitions, and broad desktop capabilities. Pivi intentionally retains its desktop-only filesystem, process, MCP, session, and clipboard features, but can use the public owner-realm DOM helpers, index its React settings surface, and avoid unnecessary automatic process/clipboard/vault access.

## Goal and success criteria

- [x] Production source passes `obsidianmd/prefer-create-el` and `obsidianmd/settings-tab/prefer-setting-definitions` without exemptions.
- [x] Obsidian 1.13 indexes and renders the React settings page through definitions while 1.12 retains `display()` fallback behavior.
- [x] CLI is default-off, stdio MCP is not prewarmed automatically, MCP config import requires explicit paste, and avoidable vault enumeration is removed.
- [x] Relevant focused tests, boundaries, typecheck, lint, build, plugin reload, and runtime error inspection complete or have recorded environmental blockers.
- [x] Durable docs and nearest `AGENTS.md` files describe the final behavior.

## Scope and non-goals

In scope:

- Public Obsidian DOM helpers, declarative settings bridge, owner-realm inline-edit factory, default-skills prompt presentation boundary.
- CLI/MCP/clipboard/vault-access hardening, tests, and documentation.

Not in scope:

- Removing desktop filesystem, process, session, MCP stdio, Vault search, or explicit copy/paste capabilities.
- Hiding security-sensitive APIs from static analysis.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Keep `minAppVersion` at 1.12.0 and implement the official dual-support settings path. | Existing 1.12 users retain the React settings page; 1.13 gains search indexing. | WS-01 |
| 2026-07-17 | Preserve desktop capabilities but default CLI off and make stdio MCP lazy. | Reduces ambient execution without deleting explicitly configured functionality. | WS-02 |
| 2026-07-17 | Replace ambient clipboard reads with explicit paste input. | Preserves configuration import without reading unrelated clipboard contents. | WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | DOM APIs, settings search bridge, inline-edit/default-skills presentation boundaries | /root | Done | None | Focused lint, typecheck, UI tests |
| WS-02 | CLI, MCP, clipboard, and vault access hardening | /root/ws02_security | Done | None | Focused core/app/React tests, focused ESLint, boundaries |
| WS-03 | Documentation, full verification, deploy, and closeout | /root | Done | WS-01, WS-02 | Full commands and Obsidian CLI |

## Verification

- `npm run check:boundaries`
- `npm run typecheck`
- `npm run lint`
- Focused Jest suites for settings, inline edit, MCP, tools settings, and vault API.
- `npm run build`
- `obsidian plugin:reload id=pivi`
- `obsidian dev:errors`

## Documentation sync

- Numbered developer docs: `docs/07-tools-skills-mcp-and-integrations.md`.
- Nearest local guidance: `src/app/AGENTS.md`, `src/ui/inline-edit/AGENTS.md`, and affected UI guidance.
- Parent/package guidance: affected package `AGENTS.md` files.
- Root guidance and roadmap: `AGENTS.md` for MCP prefetch/default behavior.

## Progress and handoff

### 2026-07-17 — /root — coordination

- Changed: Reserved spec 014 and recorded the approved decisions/workstreams.
- Evidence: User-approved implementation plan and official Obsidian 1.13 declarative-settings guidance.
- Remaining: WS-01 through WS-03.
- Blockers: None.
- Next action: Implement and verify independent workstreams.

### 2026-07-17 — /root/ws02_security — security behavior hardening

- Changed: Made missing CLI configuration default to disabled; limited app and runtime MCP prefetch to enabled remote servers; replaced ambient clipboard reads with an explicit localized JSON paste/confirm editor; resolved Base files through direct path/metadata lookup; and skipped vault enumeration for unresolved-only graph requests. Updated security and package guidance.
- Evidence: Six focused Jest suites passed (83 tests); focused ESLint passed; `npm run check:boundaries` passed, including locale parity/dead-key and spec checks; source typecheck passed.
- Remaining: Root full lint/build/deploy/runtime verification and WS-01 completion.
- Blockers: Full test typecheck currently reaches a concurrent WS-01 test typing error at `tests/pivi-react/PiviSettingTabHost.test.ts:98` (`definition.render` possibly undefined); no WS-02 blocker remains.
- Next action: Coordinator completes WS-01, reruns the full verification matrix, deploys, and inspects Obsidian runtime errors.

### 2026-07-17 — /root — DOM, settings, and closeout

- Changed: Replaced production DOM construction with owner-realm Obsidian helpers; moved the default-Skills prompt into app presentation; split inline-edit widget/container options; added the localized Obsidian 1.13 setting definition with a 1.12 fallback; enabled both review lint rules; synchronized the presentation and package guidance.
- Evidence: `npm run check:boundaries`, `npm run typecheck`, and `npm run lint` passed. Full Jest passed 255 suites / 1952 tests. `npm run build` deployed production artifacts. `obsidian plugin:reload id=pivi` succeeded and `obsidian dev:errors` reported `No errors captured.` Production source scans found no raw `createElement*` / `createDocumentFragment` calls and no `navigator.clipboard.readText` call. Obsidian 1.13.2 live validation opened Pivi through the declarative settings result, mounted one React root, confirmed the definition row computed to `display: block`, zero padding, and no top border, matched the localized `工具` alias after switching to Simplified Chinese, and restored English afterward without captured errors.
- Remaining: None.
- Blockers: None.
- Next action: Archive the completed spec with this change.

## Completion summary

Pivi retains its explicit desktop integrations while reducing ambient authority: CLI defaults off, stdio MCP is lazy, MCP JSON import requires user paste/confirmation, and avoidable Vault enumeration is removed. Production UI now uses popout-safe Obsidian DOM helpers, host-neutral core no longer constructs prompt DOM, inline edit receives an owner-realm container factory, and the existing React settings surface participates in Obsidian 1.13 search without dropping 1.12 support. The full verification and live Obsidian reload completed without runtime errors.
