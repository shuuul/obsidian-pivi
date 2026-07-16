---
id: "012"
title: "Split subscription model identities"
status: Completed
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex"
---

# 012 — Split subscription model identities

## Context

The post-0.10.0 Grok Build and Claude OAuth work separated provider cards and credential slots, but those cards still persisted the backing `xai/*` and `anthropic/*` model keys. That collapses API-key and OAuth selection, provider lifecycle controls, readiness tests, and runtime credential routing. Local providers also render a redundant Authentication (optional) section instead of placing their optional API key directly below Base URL.

## Goal and success criteria

Deliver distinct subscription model identities and a compact local-provider credential layout.

- [x] Grok Build models persist as `grok-build/*` and use only the Grok OAuth slot.
- [x] Claude models persist as `claude/*` and use only the Claude OAuth slot.
- [x] `xai/*` and `anthropic/*` continue to use only their API-key credentials.
- [x] Disable, remove, ordering, fallback, readiness, testing, and runtime resolution use the same provider namespace.
- [x] Disconnecting subscription OAuth preserves the matching API key.
- [x] Claude browser OAuth cancellation terminates the pending login.
- [x] Credential migration is eager, idempotent, and preserves an existing subscription credential.
- [x] Ollama, LM Studio, and llama.cpp show API Key (Optional) directly below Base URL without an Authentication (optional) heading.
- [x] Focused regression tests, typecheck, lint, boundaries, full tests, production build, and Obsidian reload pass.

## Scope and non-goals

In scope:

- Provider/model identity, credential routing, migration, settings presentation, tests, and durable developer guidance.

Not in scope:

- Changing upstream OAuth endpoints or adding new providers.
- Preserving the incomplete post-0.10.0 shell/backing model-list behavior.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Subscription plans receive real registry provider/model keys; backing API mapping stays inside the Pi engine. | One stable provider namespace makes persistence, UI, runtime auth, lifecycle controls, and tests agree. | WS-01, WS-02 |
| 2026-07-17 | Local-provider optional API keys render inside the endpoint panel directly after Base URL. | Removes the redundant authentication subsection while retaining optional credentials. | WS-03 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Subscription provider/model and credential runtime | Codex | Completed | None | Auth/model unit tests |
| WS-02 | Migration, settings lifecycle, and regression coverage | Codex | Completed | WS-01 | Settings/runtime tests |
| WS-03 | Local provider credential layout and i18n | Codex | Completed | None | React settings tests |
| WS-04 | Independent implementation review | oauth-verifier | Completed | WS-01–WS-03 | Evidence-oriented review |

## Verification

- `npm run check:specs`
- `npm run typecheck`
- `npm run lint`
- `npm run check:boundaries`
- Focused Jest suites for provider OAuth, credentials, settings, model resolution, and migration.
- `npm run test -- --runInBand`
- `npm run build && obsidian reload`
- `obsidian dev:errors`

## Documentation sync

- Numbered developer docs: update the authentication/model-provider developer document selected during implementation.
- Nearest local guidance: `packages/pivi-agent-core/src/engine/pi/AGENTS.md`, `packages/pivi-react/AGENTS.md` when behavior changes invalidate their maps.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md` if the auth/model boundary changes.
- Root guidance and roadmap: no root workflow change expected.

## Progress and handoff

### 2026-07-17 — Codex — WS-01

- Changed: Created the active implementation contract before parallel verification.
- Evidence: Review findings from the 0.10.0-to-worktree diff identify the shell/backing identity collapse and credential lifecycle failures.
- Remaining: Implementation, tests, documentation, build, and live reload.
- Blockers: None.
- Next action: Install subscription providers with distinct model keys and OAuth-only auth.

### 2026-07-17 — oauth-verifier — WS-04

- Changed: Completed a read-only design verification against the current worktree and installed `@earendil-works/pi-ai@0.80.8`; no source files were changed.
- Evidence: pi-ai keys credential reads, OAuth refresh locking, login/logout persistence, auth resolution, and stream dispatch by `Provider.id`. A runtime probe with a real xAI provider plus an OAuth-only alias resolved `xai/*` from the API-key slot and `grok-build/*` from the OAuth slot independently. The smallest correct design is therefore two real providers whose models carry the product provider id, whose auth exposes only the backing provider's OAuth method, and whose stream methods use the appropriate product transport.
- Evidence: The current dual-slot credential adapter still falls back from `xai` / `anthropic` to subscription OAuth, while OAuth login/logout and settings model listing map subscription ids back to the API provider. Those paths must be removed once alias providers are installed; direct alias login/logout then naturally writes, refreshes, and deletes only the alias slot.
- Evidence: Split credential migration currently overwrites an existing destination OAuth credential and runs from Models-tab bootstrap. The safe eager rule is: preserve any existing destination credential, move a legacy main-slot OAuth only when the destination is empty, always clear the legacy main-slot OAuth, add the subscription provider when the final destination is OAuth, and make a second run a no-op. Run it during plugin settings load before workspace service construction.
- Evidence: Existing shared model keys are ambiguous when both cards are present. Deterministic least-loss migration should rewrite backing-prefixed visible/current/title keys when only the subscription card exists; when both cards exist, retain backing keys and add alias-key copies rather than guessing which card originally selected them.
- Remaining: Add regression coverage for registry/model identities, auth isolation in both directions, OAuth refresh slot ownership, awaited alias-only logout, Claude outer-plus-prompt cancellation, alias-scoped disable/remove/test/readiness, destination-preserving idempotent eager migration, and both model-key migration cases.
- Blockers: None.
- Next action: Implement the real alias providers and delete the shell/backing UI and credential-routing compatibility paths before running the focused verification matrix.

### 2026-07-17 — Codex — WS-01–WS-04 closeout

- Changed: Installed real OAuth-only plan providers with plan-prefixed model keys; removed cross-provider credential fallback and settings remaps; made logout awaited and alias-scoped; fixed dual-signal OAuth cancellation; moved idempotent, destination-preserving migration to plugin settings load; and placed local optional API keys directly below Base URL.
- Evidence: Focused auth/settings/React suites passed; `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and `npm run test -- --runInBand` passed (251 suites, 1929 tests).
- Evidence: `npm run build` succeeded, bundle size was 3,091,532 bytes (2.95 MB), `obsidian plugin:reload id=pivi` succeeded for the configured vault, and `obsidian dev:errors` reported no errors.
- Evidence: Durable behavior was synchronized into `docs/08-presentation-settings-and-inline-edit.md` and the nearest core, React, and app `AGENTS.md` files.
- Remaining: None.
- Blockers: None.
- Next action: Archive the completed spec.

### 2026-07-17 — Codex — pre-commit review follow-up

- Changed: Preserved ambiguous backing-provider selections when both identities already exist, deduplicated legacy xAI selections that converge on Composer, preserved destination credentials of every kind, and cancelled active provider OAuth work during workspace disposal.
- Evidence: Independent pre-commit review and focused re-review passed. `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, all 252 suites / 1,937 tests, production build, Obsidian reload, and live error inspection passed.
- Remaining: None.
- Blockers: None.
- Next action: Commit the reviewed scope.

## Completion summary

Grok Build and Claude now have independent OAuth-only provider/model identities, while xAI and Anthropic API providers remain API-key-only. Settings lifecycle operations use those exact namespaces, startup migration preserves credentials and valid selections, local endpoints use the compact optional-key layout, and the production plugin passed automated and live reload verification.
