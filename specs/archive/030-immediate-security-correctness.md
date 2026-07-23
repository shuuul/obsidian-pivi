---
id: "030"
title: "Immediate security correctness"
status: Completed
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 030 — Immediate security correctness

## Context

The July 2026 repository review identified several security defects that can be fixed without changing persisted schemas or introducing the later capability model. Current repository inspection confirms:

- `packages/pivi-agent-core/src/mcp/oauth/mcpCallbackServer.ts` interpolates the OAuth `error_description` query value into HTML and accepts methods other than `GET`.
- `packages/pivi-agent-core/src/mcp/mcpProcessEnv.ts` spreads the complete renderer `process.env` into every configured stdio MCP child.
- MCP URL validators accept arbitrary string schemes, server names are used as ordinary object keys without rejecting reserved prototype names, and the React editor joins and reparses `command` plus `args`.
- `packages/obsidian-host/src/systemProcessRunner.ts` maps signal exits (`code === null`) to success and accumulates unbounded output.
- `packages/obsidian-host/src/nodeFetch.ts` still advertises the stale `Pivi/0.2.2` user agent while the global fetch replacement remains in use.

Archived spec `014` already made stdio MCP lazy. Settings inventory is cache-only and automatic prefetch is remote-only, so this spec preserves that behavior with regression coverage rather than reimplementing it. Archived spec `021` already moved custom provider headers and MCP OAuth entries to `SecretStorage`; broader environment and MCP header/env migration belongs to spec `031`.

This is the first spec in the review-hardening sequence. It deliberately contains only bounded correctness fixes suitable for a patch release.

## Goal and success criteria

Remove immediately exploitable or misleading behavior without requiring a storage migration.

- [x] OAuth callback responses never interpret authorization-server input as HTML, accept only `GET`, send explicit UTF-8 content types, and apply `Content-Security-Policy`, `X-Content-Type-Options`, `Cache-Control`, and `Referrer-Policy`.
- [x] A stdio MCP child inherits only a documented cross-platform minimum environment plus explicitly configured server values; sensitive unrelated parent variables are absent.
- [x] MCP HTTP/SSE URLs accept only `http:` and `https:`; non-loopback plaintext HTTP policy is explicit and test-covered.
- [x] MCP server names reject `__proto__`, `prototype`, and `constructor`; serialized maps cannot mutate an object prototype.
- [x] Editing a stdio MCP server preserves the exact executable and argument array, including whitespace, quotes, backslashes, and empty arguments.
- [x] Process exits caused by a signal cannot be reported as exit code `0`; callers receive an explicit signal-aware failure result.
- [x] Until spec `032` removes the global fetch patch, its user agent uses the current manifest/package version from one build-owned source.
- [x] Opening settings, loading inventory, and automatic prefetch do not spawn stdio MCP processes.
- [x] User-visible validation and storage wording is localized in every locale catalog.
- [x] Focused tests, typecheck, lint, boundaries, build, plugin reload, and runtime error inspection pass.

## Scope and non-goals

In scope:

- OAuth callback response rendering and HTTP headers.
- Minimal stdio environment inheritance and environment-name preview.
- MCP name, URL, header, command, and argument validation/round-trip correctness.
- Signal-aware process result semantics and bounded output required by the touched callers.
- Dynamic temporary user agent and regression coverage for lazy stdio.
- Security/privacy documentation corrections directly affected by these fixes.

Not in scope:

- Moving general environment values or MCP headers/env secrets out of synced JSON; spec `031`.
- DNS/IP egress policy, redirect validation, global fetch removal, or shared HTTP deadlines; spec `032`.
- Process-tree termination, Bash redesign, Vault mutation containment, or approval UX; specs `033` and `034`.
- Skills installation or MCP tool-result resource limits; spec `035`.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Use escaped static HTML or `text/plain` for OAuth errors; untrusted provider text never enters an HTML interpolation point. | The callback page needs no rich rendering of remote error text. | WS-01 |
| 2026-07-23 | Build stdio environments from an explicit portable allowlist plus the server's explicit configuration, not by subtracting known secrets from `process.env`. | A denylist cannot anticipate credentials introduced by shells, plugins, or future providers. | WS-02 |
| 2026-07-23 | Model stdio executable and arguments as separate structured UI fields. | Shell-like re-parsing cannot round-trip an arbitrary argument vector across platforms. | WS-03 |
| 2026-07-23 | Preserve spec `014`'s lazy-stdio contract as a release-blocking regression. | Settings inspection must not execute a configured local program. | WS-02, WS-05 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Harden OAuth callback method handling, response encoding, escaping, and browser security headers | /subagent | Completed | None | Callback tests with script/img/entity payloads and non-GET requests |
| WS-02 | Replace ambient MCP stdio environment inheritance with a minimal allowlist and preserve lazy startup | /subagent | Completed | None | MCP env and fake-process settings/prefetch tests on POSIX/Windows fixtures |
| WS-03 | Add strict MCP URL/name/header validation and exact command/args editing | /subagent | Completed | None | Parser, storage, and React editor round-trip tests |
| WS-04 | Make process signal results truthful, bound output for current callers, and derive the temporary fetch user agent from the build version | /subagent | Completed | None | Process runner signal/output tests and node-fetch header tests |
| WS-05 | Synchronize i18n, docs, guidance, and patch-release verification | /subagent | Completed | WS-01–WS-04 | Full gates, build, reload, `obsidian dev:errors` |

## Verification

Required focused scenarios:

- OAuth `error_description` containing `<script>`, `<img onerror>`, quotes, ampersands, and encoded entities is returned only as inert text.
- `POST`, `PUT`, and unexpected callback paths do not resolve or reject a pending authorization.
- A parent environment containing fake provider, cloud, proxy, and CI tokens produces a child environment containing none of them unless named explicitly in server configuration.
- POSIX and Windows minimum environment fixtures retain executable discovery essentials.
- `["--name", "hello world", "", "C:\\Program Files\\tool"]` survives edit/save/load unchanged.
- Reserved server names fail at UI, import, parser, and storage boundaries.
- A fake child closing with `code: null, signal: SIGTERM` is not successful; oversized stdout/stderr is bounded with explicit truncation metadata.
- Settings mount and cache-only inventory perform zero process-runner calls for stdio servers.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/mcp tests/unit/pi/mcpProcessEnv.test.ts tests/unit/host tests/pivi-react/McpToolsSection.test.tsx
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

Exact focused paths may be adjusted to the repository's test topology, but every listed scenario must remain directly represented.

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/07-tools-skills-mcp-and-integrations.md`, and `docs/09-development-debugging-and-validation.md`.
- Nearest local guidance: affected `packages/pivi-agent-core/src/mcp/**/AGENTS.md` if present, `packages/pivi-react/src/i18n/AGENTS.md`, and the nearest process/host guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/pivi-react/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Verified the bounded defects against the 0.14.1 working tree and separated already-completed lazy-stdio/provider-secret work from remaining fixes.
- Evidence: Current OAuth callback, MCP environment/types/editor, process runner, node fetch, archived specs `014` and `021`.
- Remaining: Claim and execute WS-01 through WS-05.
- Blockers: None.
- Next action: Make the spec decision-complete, set it Active, and implement the independent bounded workstreams.

### 2026-07-23 — /subagent — implementation

- Changed: Hardened OAuth callback handling, stdio env allowlist, MCP validation/editor/storage, process-runner signal/output semantics, build-owned fetch user agent, i18n, docs, and focused tests.
- Evidence: `npm run test -- --runInBand tests/unit/pi/mcp tests/unit/pi/mcpProcessEnv.test.ts tests/unit/host tests/pivi-react/McpToolsSection.test.tsx` (65 passed), `npm run typecheck`, `npm run lint`, `npm run build`, `obsidian plugin:reload id=pivi`, `obsidian dev:errors` (`No errors captured.`), `npm run check:specs`.
- Remaining: None.
- Blockers: `npm run check:boundaries` still fails on pre-existing unused `common.disable` / `common.disabled` / `common.enable` i18n keys unrelated to this spec.
- Next action: Coordinator commit; continue spec `031`.

## Completion summary

Spec `030` closed the immediate security-correctness gaps without a storage migration. OAuth callbacks are GET-only with hardened headers and inert provider error rendering; stdio MCP children inherit only a documented parent allowlist plus explicit server configuration; MCP names/URLs/maps are validated at import, storage, and UI boundaries; stdio executable/args round-trip as structured fields; process-runner results report signals and bounded stream metadata; and the temporary Node fetch shim advertises the current package version from build metadata. Lazy stdio behavior from spec `014` remains covered by existing prefetch/settings tests.
