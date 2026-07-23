---
id: "032"
title: "Network egress and HTTP client"
status: Completed
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 032 — Network egress and HTTP client

## Context

Pivi currently calls `patchRendererFetchForElectron()` at module load, replacing `window.fetch` for the entire renderer realm without ownership-aware restoration. The replacement in `packages/obsidian-host/src/nodeFetch.ts` is a partial `Response` implementation, selects plain HTTP for every non-HTTPS scheme, has no redirect/deadline/body-size policy, and buffers `text()`/`json()` completely.

`WebFetch` validates only the `http:`/`https:` scheme. It can access loopback, private, link-local, multicast, and metadata addresses; does not revalidate DNS or redirects; submits the target URL to configured third-party extraction providers before direct fallback; buffers direct responses before `maxChars`; and includes the complete target URL in terminal errors. These behaviors create SSRF, DNS/redirect pivot, memory, privacy, and log-leak risks.

This is the third review-hardening spec. It depends on spec `030` for baseline URL validation and spec `031` for source-aware sensitive headers. It replaces the temporary global-fetch/user-agent work from spec `030` with the durable scoped network boundary.

## Goal and success criteria

Route every Pivi network client through explicit, scoped HTTP capabilities with a single enforceable egress policy.

- [x] Pivi never assigns to global `window.fetch`; unload has no fetch restoration obligation and other plugins/Obsidian retain their original fetch identity.
- [x] Pi providers, MCP/OAuth, WebSearch/WebFetch, image generation, and other network integrations receive explicit HTTP clients from composition.
- [x] Only `http:` and `https:` URLs reach network transports; username/password URL credentials are rejected.
- [x] Default policy rejects loopback, private, link-local, multicast, unspecified, and cloud-metadata destinations for IPv4 and IPv6, including alternate IP representations.
- [x] Hostnames are resolved and checked before connect; the connected address is pinned/verified against the approved resolution to resist DNS rebinding.
- [x] Every redirect is resolved, normalized, and rechecked; redirect count is bounded.
- [x] Connect, first-byte, idle, and total deadlines are explicit and abortable.
- [x] Request and response byte limits are enforced while streaming; output character limits do not stand in for transport limits.
- [x] Allowed response content types are explicit per caller; decompression cannot bypass byte limits.
- [x] Logs, errors, audit entries, and UI redact URL credentials and sensitive query values.
- [x] WebFetch offers an explicit direct-only mode and obtains a clear user policy/setting before sending a target URL to Tavily, Exa, AnySearch, or another extractor. *(Superseded 2026-07-23: removed `fetchMode`; WebFetch always tries enabled extractors before direct HTTP.)*
- [x] Local-network access, when enabled, is origin-scoped and turn-scoped rather than a permanent global bypass.
- [x] A standard-compatible `Response` surface is returned where an upstream SDK requires Fetch semantics.

## Scope and non-goals

In scope:

- Host-neutral HTTP request/response/egress contracts and Obsidian/Electron implementation.
- Dependency injection through app composition into Pi, MCP, OAuth, web tools, and image/provider clients.
- DNS/IP classification, address pinning, redirects, deadlines, streaming limits, content types, decompression limits, and URL redaction.
- WebFetch provider-disclosure/direct-only behavior and turn-scoped local-origin authorization hook.
- Removal of global renderer fetch replacement and stale compatibility code.

Not in scope:

- General tool capability profiles and audit log storage; spec `034` consumes the network decisions established here.
- Proxy-specific enterprise policy beyond preserving an explicitly configured proxy through a reviewed adapter.
- A browser automation client.
- Backward-compatible support for arbitrary schemes accepted by the old shim.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Enforce egress at the lowest shared transport boundary and require callers to declare purpose-specific policy. | Call-site-only validation can be bypassed by redirects, SDK internals, or future clients. | WS-01, WS-02 |
| 2026-07-23 | Deny local/private/metadata destinations by default and represent exceptions as short-lived origin grants. | Broad permanent allowlists turn prompt injection into durable network authority. | WS-01, WS-04 |
| 2026-07-23 | Stream and bound encoded plus decoded bytes independently. | Compressed responses can evade a limit applied only after decompression or text conversion. | WS-02 |
| 2026-07-23 | Do not send the user's target URL to a third-party extractor without an explicit product-level mode. | Extraction is a disclosure of the full target, including potentially sensitive paths/query data. | WS-03 |
| 2026-07-23 | Remove the WebFetch `fetchMode` setting; always try enabled extractors before direct HTTP. | Product prefers simpler Web tools settings and accepts third-party URL disclosure by default. | WS-03 follow-up |
| 2026-07-23 | Remove the global fetch patch rather than adding an unload restoration shim. | Explicit injection yields a testable ownership boundary and avoids renderer-wide side effects. | WS-04 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define URL normalization/redaction, IP classification, DNS pinning, redirect, and origin-grant policy | /032-network | Completed | Specs 030–031 completed | Pure IPv4/IPv6/DNS/redirect policy tests |
| WS-02 | Implement scoped streaming HTTP client with deadlines, abort, byte/content/decompression limits, and standard response adaptation | /032-network | Completed | WS-01 | Local adversarial HTTP server integration tests |
| WS-03 | Rework WebFetch provider disclosure, direct-only mode, errors, and bounded streaming | /032-network | Completed | WS-01, WS-02 | WebFetch chain/privacy/oversize tests |
| WS-04 | Inject clients into Pi, MCP/OAuth, image, and app composition; delete global fetch patch | /032-network | Completed | WS-02 | Architecture checks and original-fetch identity test |
| WS-05 | Documentation, threat model entries, full gates, live reload, and network regression matrix | /032-network | Completed | WS-01–WS-04 | Full verification and runtime inspection |

## Verification

Use deterministic local DNS/HTTP fixtures or injected resolvers; tests must not depend on public network availability.

Required cases:

- IPv4 loopback/private/link-local/multicast/metadata, IPv6 loopback/ULA/link-local/IPv4-mapped forms, integer/hex/octal/mixed IP inputs, and IDNA host normalization.
- A public-looking hostname resolving to a private address, resolution changing between validation/connect, and a redirect from public to private.
- Redirect loops, excess redirects, cross-origin sensitive-header stripping, scheme downgrade policy, and URL credential rejection.
- Slow connect/headers/body, abort during each phase, infinite body, misleading content length, compressed expansion, and disallowed content type.
- Query values named or shaped like tokens/signatures are redacted without destroying safe origin/path diagnostics.
- Direct-only WebFetch never calls an extractor; extractor mode exposes the disclosure in UI/settings and sends only after authorization. *(Superseded: no direct-only mode remains; settings disclosure removed with the `fetchMode` control.)*
- Provider SDK and MCP/OAuth smoke fixtures use injected clients successfully.
- Plugin load/unload leaves `window.fetch` strictly identical to its pre-load value.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/tools/webSearch
npm run test -- --runInBand tests/unit/mcp
npm run test -- --runInBand tests/unit/host
npm run test -- --runInBand tests/integration
npm run check:architecture
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

Evidence (2026-07-23):

- Focused suites: `tests/unit/network`, `tests/unit/host`, `tests/unit/pi/tools/webSearch`, `tests/unit/pi/mcp`, `tests/integration` — 24 suites / 93 tests passed.
- `npm run typecheck`, `npm run lint`, `npm run check:architecture`, `npm run check:boundaries`, `npm run build` passed.
- Pre-existing unused i18n keys `common.disable` / `common.disabled` / `common.enable` still reported by dead-key check (unchanged, not cleaned here).
- `obsidian plugin:reload id=pivi` succeeded; `obsidian dev:errors` → `No errors captured.`

## Documentation sync

- Numbered developer docs: `docs/02-architecture-and-technology.md`, `docs/03-plugin-lifecycle-and-composition.md`, and `docs/07-tools-skills-mcp-and-integrations.md`.
- Nearest local guidance: `src/app/AGENTS.md`, `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, and nearest web/MCP/host guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/obsidian-tools/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md` if introduced, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Grouped the global fetch side effect and WebFetch SSRF/privacy/body-limit findings under one transport boundary.
- Evidence: `src/main.ts`, `packages/obsidian-host/src/nodeFetch.ts`, `packages/pivi-agent-core/src/tools/webSearch/fetch.ts`, and current injected MCP fetch ports.
- Remaining: Finalize policy constants/host capabilities and execute WS-01 through WS-05 after specs `030` and `031`.
- Blockers: Source-aware sensitive headers from spec `031` must exist before redirect/header forwarding rules become final.
- Next action: Complete prior specs, then activate this spec and implement the shared policy before migrating callers.

### 2026-07-23 — /032-network — activation

- Changed: Set status to Active; claimed WS-01 through WS-05.
- Evidence: Specs 030–031 archived; working tree on main.
- Remaining: Implement policy, streaming client, WebFetch disclosure, composition injection, docs, and verification.
- Blockers: None.
- Next action: Implement host-neutral egress policy and Obsidian streaming HTTP client.

### 2026-07-23 — /032-network — completion

- Changed: Implemented shared egress policy, scoped streaming HTTP client, WebFetch direct-only default + extractor disclosure setting, composition injection, removal of global fetch patch, docs/`SECURITY.md`, and verification.
- Evidence: Focused Jest suites, typecheck/lint/architecture/boundaries/build, Obsidian reload with zero captured errors.
- Remaining: None for this spec. Specs 033+ can consume network decisions for process/vault and high-risk capability profiling.
- Blockers: None.
- Next action: Archive this spec.

## Completion summary

Scoped HTTP clients now enforce SSRF-resistant egress at the shared transport: only http(s), no URL credentials, default deny for private/metadata destinations, DNS pin + redirect revalidation, streaming byte/deadline/content-type limits, and redacted diagnostics. WebFetch defaults to direct-only with an explicit settings disclosure for extractors. Composition injects purpose-scoped clients; the production bundle resolves free `fetch` via inject without assigning `window.fetch`.

### 2026-07-23 — /032-network — WebFetch mode removal

- Changed: Removed `webSearchTools.fetchMode` and the Settings > Tools > Web control. WebFetch always runs the ordered extractor chain (Tavily, Exa, AnySearch) before the direct HTTP terminal fallback.
- Evidence: Updated settings/types, WebFetch tool chain, i18n copy, `SECURITY.md`, handbook docs, and focused Jest coverage.
- Remaining: None for this follow-up.
- Blockers: None.
- Next action: None.
