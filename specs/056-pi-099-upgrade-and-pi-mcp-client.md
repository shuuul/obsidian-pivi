---
id: "056"
title: "Pi 0.99 upgrade and pi-mcp client migration"
status: Active
created: 2026-09-30
updated: 2026-09-30
coordinator: "Claude Code"
---

# 056 — Pi 0.99 upgrade and pi-mcp client migration

## Context

Pivi pinned `@earendil-works/pi-*` at `0.87.1`. Upstream `0.99.0` added MCP support in two forms:

- `createMcpExtension()` in `pi-coding-agent`, a built-in extension that needs `AgentSession`, `DefaultResourceLoader`, `bindExtensions()`, reads `~/.pi/agent/mcp.json`, and brings stdio, codemode (QuickJS WASM), and TUI wiring.
- `@earendil-works/pi-mcp`, a standalone MCP client with no dependency on the official SDK or other pi packages: Streamable HTTP with injectable `fetch`, OAuth (PKCE, dynamic client registration, refresh, step-up) with an injectable state store, resources, `toLlmContent()`, and an in-memory testing transport. It does not support the legacy HTTP+SSE transport.

`0.99.0` also added Sign in with ChatGPT as OAuth on the `openai` provider (api.openai.com, dynamic client, `chatgpt.tokens.use.direct` scope, stable device id as the OpenAI agent host), distinct from the Codex login (`openai-codex`, chatgpt.com backend).

## Goal and success criteria

- [x] All four Pi packages (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-mcp`) pinned at one exact version; `check:pi-pins` and `check:pi-compatibility` green.
- [x] ChatGPT sign-in is available as its own OAuth provider (`chatgpt/*`) with the OpenAI icon; OpenAI Codex stays unchanged.
- [x] `@pivi/agent/mcp` uses `@earendil-works/pi-mcp`; `@modelcontextprotocol/sdk` and `build/plugins/shim-mcp-validation.mjs` are removed.
- [x] Legacy `type: "sse"` MCP entries are rewritten on load to disabled Streamable HTTP entries (URL, headers, and secrets kept) with a one-time localized notice pointing at the Streamable HTTP endpoint.
- [ ] Local CI-equivalent suite green, including `check:bundle-size`.

## Scope and non-goals

In scope: pin bump and compatibility updates, ChatGPT OAuth provider, MCP client/OAuth/tester migration to pi-mcp, SSE removal.

Not in scope:

- `pi-coding-agent`'s `createMcpExtension()`: it requires `AgentSession` (see root `AGENTS.md`), host-global MCP config, and stdio.
- Codemode (`@earendil-works/pi-codemode`): deferred to the roadmap; it needs QuickJS WASM loading in Obsidian, bundle headroom, and a script permission design.
- Stdio MCP (still unsupported).

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-09-30 | Adopt standalone `@earendil-works/pi-mcp`, not `createMcpExtension()`. | Pivi runs an in-process `Agent` without `AgentSession`; the extension also reads host-global config and pulls stdio/codemode/TUI. | WS-02 |
| 2026-09-30 | Drop legacy SSE MCP support. | pi-mcp does not implement HTTP+SSE; keeping the official SDK for SSE alone would forfeit the bundle savings and maintain two clients. | WS-02 |
| 2026-09-30 | Pin `pi-mcp` together with the other Pi packages. | One upstream release train; one compatibility canary. | WS-01, WS-02 |
| 2026-09-30 | Model ChatGPT sign-in as an OAuth-only `chatgpt` provider over pi-ai's `openai` provider; `openai` becomes API-key only. | Mirrors the `claude`/`anthropic` split so credentials, readiness, and model namespaces stay isolated. The device id is stored device-locally (`pivi.device-id.v1`). | WS-01 |
| 2026-09-30 | Rewrite legacy SSE entries to disabled `http` entries instead of dropping them. | Dropping would delete the entry and orphan header secrets on the next save; a disabled entry keeps URL/headers/secrets visible and editable in Settings. | WS-02 |
| 2026-09-30 | Pivi owns the OAuth client-credentials grant (`mcpClientCredentials.ts`). | pi-mcp implements only the authorization-code flow; the official SDK previously provided client credentials. | WS-02 |
| 2026-09-30 | Remove the MCP editor's transport selector. | Streamable HTTP is the only transport; the row would offer a single option. Needs human visual sign-off of the MCP editor layout. | WS-02 |
| 2026-09-30 | Accept the ~210 KiB bundle growth from pi 0.99.1. | Upstream moved pi-ai to `openai@7` (+143 KiB) and grew the OpenRouter catalog (+37 KiB); WS-02 removes the MCP SDK, zod, and cfworker validator. | WS-01, WS-02 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Pi 0.87.1 → 0.99.1, ChatGPT OAuth provider | Claude Code | Done | None | typecheck, lint, `check:boundaries`, `npm run test`, `test:pi-compat` |
| WS-02 | MCP client migration to pi-mcp; SSE removal | Claude Code | Done | WS-01 | MCP unit tests, full suite, bundle size, live Obsidian MCP connect/OAuth |

## Verification

- `npm run check:dependencies && npm run typecheck && npm run lint && npm run check:boundaries && npm run test:coverage && npm run build && npm run check:bundle-size`
- `npm run test:pi-compat`
- `npm run check:specs`
- Human visual sign-off: Settings > MCP servers add/edit editor (inline and modal) without the Type row, in light and dark themes; Settings > Models Add provider picker shows ChatGPT next to OpenAI Codex with the OpenAI icon.
- Manual in Obsidian: ChatGPT sign-in and a chat turn on a `chatgpt/*` model; OpenAI Codex sign-in unchanged; connect an HTTP MCP server (with and without OAuth) and call a tool; a legacy SSE entry shows the migration notice.

## Documentation sync

- Numbered developer docs: `docs/08-presentation-and-settings.md` (ChatGPT provider), `docs/07-tools-skills-mcp-and-integrations.md` (MCP client, SSE removal).
- Nearest local guidance: `packages/engine-pi/AGENTS.md`, `packages/agent/AGENTS.md`, `packages/pivi-react/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md` (MCP implementation owner, Pi pin set), `docs/10-roadmap-release-and-maintenance.md` (codemode deferred).

## Progress and handoff

### 2026-09-30 — Claude Code — WS-01

- Changed: pins, compatibility manifest versions, shim `VERSION`; `chatgpt` subscription provider, bundled `openaiChatGPT` loader, device-local installation id, i18n in all locales.
- Evidence: typecheck/lint/boundaries green; full Jest suite green.
- Remaining: live Obsidian sign-in check.
- Blockers: None.
- Next action: WS-02.

### 2026-09-30 — Claude Code — WS-02

- Changed: `@modelcontextprotocol/sdk`, `legacySseTransport.ts`, and `shim-mcp-validation.mjs` removed; `mcpHttpClient.ts` and `oauth/mcpClientCredentials.ts` added; pool, tester, OAuth provider/flow/service moved to pi-mcp; legacy SSE upgrade in `McpStorage` plus notice in composition; MCP editor transport selector and its locale keys removed; `check:pi-pins`, `check:pi-compatibility`, the Pi canary, ESLint, and `check:architecture` extended to `pi-mcp` (allowed only in `@pivi/agent/src/mcp`); zod/SDK-only overrides dropped; `@cfworker/json-schema` moved to devDependencies.
- Evidence: typecheck, lint, boundaries, coverage suite, build, and bundle size green; `main.js` 4.90 MB after WS-01 → 4.75 MB (pi-mcp contributes ~32 KB; stdio transport and callback server are tree-shaken).
- Remaining: live Obsidian checks (ChatGPT sign-in, MCP connect with and without OAuth, legacy SSE notice) and the human visual sign-off above.
- Blockers: None.
- Next action: user verification in the reloaded plugin.

## Completion summary

Pending.
