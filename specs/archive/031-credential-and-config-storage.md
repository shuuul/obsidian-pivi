---
id: "031"
title: "Credential and config storage"
status: Completed
created: 2026-07-23
updated: 2026-07-23
coordinator: "/root"
---

# 031 — Credential and config storage

## Context

Spec `021` established the desired ownership pattern for device-local provider state and moved custom provider headers plus MCP OAuth entries into Obsidian `SecretStorage`. Two broader configuration channels remain outside that boundary:

- `sharedEnvironmentVariables` and `agentSettings.environmentVariables` remain free-form text in synced `.pivi/settings.json`; provider and web credential resolvers intentionally consume recognized keys from that text.
- MCP remote `headers` and stdio `env` remain plain `Record<string, string>` values serialized into synced `.pivi/mcp.json`; only the dedicated bearer token and OAuth client secret are stripped.

Current settings and MCP loaders also treat malformed JSON as defaults/empty lists, and MCP save mutates secrets before the JSON publication succeeds. The review correctly identifies a risk of silent overwrite, orphan secrets, or deleted old secrets when a later write fails.

This is the second review-hardening spec. It depends on spec `030` for strict names/URLs/structured MCP arguments so migration never canonicalizes invalid configurations.

## Goal and success criteria

Give every environment/header value an explicit storage source, keep device facts and secrets out of synced vault JSON, and publish settings/config changes transactionally.

- [x] Runtime environment configuration uses a structured, versioned model with `plain`, `secret`, and `systemEnvironment` value sources.
- [x] Environment configuration is device-local by default; no environment value or machine-specific path is written to `.pivi/settings.json`.
- [x] Secret-like environment keys default to `SecretStorage`; provider keys are migrated into their canonical credential stores when possible.
- [x] MCP headers and stdio env use structured value sources; sensitive headers/env values are absent from `.pivi/mcp.json` and local storage.
- [x] Existing plaintext environment, MCP header, and MCP env values migrate idempotently; source plaintext is removed only after destination publication succeeds.
- [x] The UI shows the effective storage location and never echoes stored secret values after reload.
- [x] Settings save blocks unresolved secret-like plaintext unless the user intentionally changes the value source to an allowed non-secret mode.
- [x] Settings and MCP parsing returns diagnostics instead of silently substituting defaults; malformed source files are preserved as recoverable corrupt artifacts before any replacement.
- [x] File and secret publication ordering is failure-safe: new secrets are staged first, config is atomically published, obsolete secrets are cleared last, and failed stages are recoverable.
- [x] Concurrent saves to the same logical file are serialized; repeated load/save is idempotent.
- [x] Two simulated devices sharing `.pivi` retain independent environment values and secrets while portable settings and non-secret MCP definitions continue to sync.

## Scope and non-goals

In scope:

- Versioned device-local environment configuration and runtime projection.
- Secret-like key classification, canonical provider credential migration, and explicit system-environment references.
- Structured MCP header/env sources and `SecretStorage` namespaces.
- Settings/MCP schema versions, diagnostics, corrupt-source preservation, per-file serialization, staged secret publication, and atomic file replacement where the host supports it.
- Localized storage/source UI and migration tests.

Not in scope:

- Passing the whole system environment to any child process; forbidden by spec `030`.
- URL egress, redirect, timeout, and response-body policy; spec `032`.
- User approval/capability policy; spec `034`.
- Synchronizing secrets across devices.
- Preserving old runtime interfaces solely for compatibility; callers must move to the new source model.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-23 | Store the environment registry in vault-scoped Obsidian local storage, with secret values referenced by ID and held only in `SecretStorage`. | Environment contents and paths are device facts; the pattern matches spec `021`. | WS-01, WS-02 |
| 2026-07-23 | Remove free-form environment text as the persisted format; UI may offer bulk import but must parse into structured entries before saving. | Storage ownership and validation cannot be made reliable inside an opaque text blob. | WS-01, WS-04 |
| 2026-07-23 | Keep portable MCP server definitions synced while replacing header/env values with typed references. | Server identity/URL/command may be portable; credentials and machine environment values are not. | WS-03 |
| 2026-07-23 | Publish new secrets before config references and delete obsolete secrets only after config publication. | A failed save must leave either the old usable state or a recoverable staged secret, never a config that references a deleted secret. | WS-05 |
| 2026-07-23 | Preserve malformed source bytes before any repair or replacement. | Silent fallback followed by save destroys the best recovery evidence. | WS-05 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define structured environment entry, local-state, persisted projection, secret-key policy, and runtime resolution contracts | Cursor Grok 4.5 | Completed | Spec 030 completed | Pure schema/projection/classification tests |
| WS-02 | Implement idempotent environment migration and canonical provider/web credential handoff | Cursor Grok 4.5 | Completed | WS-01 | Migration, two-device, retry, and no-plaintext tests |
| WS-03 | Define and implement MCP header/env references plus legacy plaintext migration | Cursor Grok 4.5 | Completed | WS-01 | MCP load/save/runtime hydration and migration tests |
| WS-04 | Replace free-form settings with source-aware localized controls and safe bulk import | Cursor Grok 4.5 | Completed | WS-01, WS-03 | React interaction, masking, i18n parity, accessibility tests |
| WS-05 | Add diagnostic parsing, corrupt preservation, serialized atomic publication, and failure-safe secret staging | Cursor Grok 4.5 | Completed | WS-02, WS-03 | Fault-injection and concurrent-save tests |
| WS-06 | Documentation, full gates, migration fixture, deploy, and closeout | Cursor Grok 4.5 | Completed | WS-01–WS-05 | Verification matrix and Obsidian reload |

## Verification

The acceptance matrix must include:

| Case | Required result |
|---|---|
| Fresh device | Environment registry is device-local; synced settings contain no environment fields or values. |
| Secret-like import | `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `AUTHORIZATION`, and `COOKIE` require a secret/canonical source by default. |
| System reference | Only the named variable is resolved at runtime; its value is not copied into any Pivi store. |
| Provider migration | Recognized provider/web keys reach the existing canonical credential store before plaintext removal. |
| MCP migration | `Authorization`, `Proxy-Authorization`, `Cookie`, API-key headers, and secret-like stdio env values become secret references; ordinary values remain explicitly plain only when allowed. |
| Two devices | Shared portable settings/MCP definitions coexist with independent local environment sources and secrets. |
| Corrupt JSON | Original bytes remain recoverable, diagnostics are visible, and no automatic save overwrites them. |
| Secret write failure | Source plaintext/config remains authoritative and retryable. |
| Config publication failure | Old config remains usable; obsolete secrets are not deleted; staged new secrets are identifiable and recoverable. |
| Concurrent save | One serialized final state is published with no mixed secret/config generation. |
| Idempotence | A second load/save performs no migration and does not rewrite unchanged stores. |

Commands:

```bash
npm run test -- --runInBand tests/unit/app/settings
npm run test -- --runInBand tests/unit/mcp
npm run test -- --runInBand tests/pivi-react/SettingsUi.test.tsx
npm run typecheck
npm run lint
npm run check:boundaries
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/07-tools-skills-mcp-and-integrations.md`, and `docs/08-presentation-and-settings.md`.
- Nearest local guidance: `src/app/AGENTS.md`, `packages/pivi-react/src/i18n/AGENTS.md`, and nearest settings/MCP guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-host/AGENTS.md`, and `packages/pivi-react/AGENTS.md`.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, and `docs/10-roadmap-release-and-maintenance.md`.

## Progress and handoff

### 2026-07-23 — /root — planning

- Changed: Defined the remaining credential/config boundary after excluding custom provider headers and MCP OAuth entries already completed by spec `021`.
- Evidence: Current settings environment fields/resolvers, MCP types/storage, spec `021` migration contract, and review findings.
- Remaining: Finalize source schemas and execute WS-01 through WS-06 after spec `030`.
- Blockers: Spec `030` must establish strict valid MCP inputs before legacy configuration migration.
- Next action: Complete spec `030`, then make this spec Active and record final schema/transaction decisions.

### 2026-07-23 — Cursor Grok 4.5 — implementation start

- Changed: Set status to Active; claimed WS-01 through WS-06.
- Evidence: Spec 030 archived; working tree clean on main at claim time.
- Remaining: Implement structured env/MCP value sources, migration, UI, transactional publication, tests, docs, and closeout.
- Blockers: None.
- Next action: Define contracts (WS-01) and implement migration + MCP + UI + publication.

### 2026-07-23 — Cursor Grok 4.5 — closeout

- Changed: Implemented structured `plain`/`secret`/`systemEnvironment` sources; device-local `pivi.environment.v1`; MCP header/env refs; transactional publication; source-aware UI + i18n; docs sync.
- Evidence: Focused matrix tests green (124); typecheck/lint/build green; Obsidian reload with `No errors captured.`; architecture boundaries passed. `check:i18n-dead-keys` still reports pre-existing unused `common.disable`/`common.disabled`/`common.enable`.
- Remaining: None for this spec.
- Blockers: None.
- Next action: Archive spec and run `npm run check:specs`.

## Completion summary

Spec 031 is complete. Environment configuration is a versioned device-local registry (`pivi.environment.v1`) with `plain` / `secret` / `systemEnvironment` sources; secrets live only in SecretStorage (`pivi-env-*`). Synced `.pivi/settings.json` no longer stores environment fields. Recognized provider/web keys migrate into canonical credential stores before plaintext removal. MCP headers and stdio env use structured `ConfigValueRef` maps with SecretStorage-backed sensitive values (`pivi-mcp-v-*`), published as stage-secrets → atomic config write → clear obsolete. Corrupt settings/MCP JSON is preserved as `.corrupt-*` artifacts with diagnostics. Settings UI lists storage location and never echoes secrets after reload; bulk import parses into structured entries (`KEY=$NAME` → systemEnvironment). Focused tests, typecheck, lint, build, and Obsidian reload all passed.
