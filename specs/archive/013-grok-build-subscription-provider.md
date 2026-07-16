---
id: "013"
title: "Grok Build subscription provider"
status: Completed
created: 2026-07-17
updated: 2026-07-17
coordinator: "Codex"
---

# 013 — Grok Build subscription provider

## Context

The initial Grok OAuth provider cloned the xAI API-key catalog and dispatched through `api.x.ai`. OAuth inference is a distinct Grok Build surface at `cli-chat-proxy.grok.com`; its account catalog includes models such as `grok-composer-2.5-fast` and requires Grok CLI identification, model override, and request compatibility.

## Goal and success criteria

- [x] Grok Build uses its inference endpoint rather than the xAI API-key endpoint.
- [x] Its model list includes `grok-composer-2.5-fast` with correct subscription metadata.
- [x] Required Grok CLI headers and model override reach every request.
- [x] Composer/Grok Build payload compatibility preserves the existing Pivi request path.
- [x] xAI API-key models and credentials remain independent and unchanged.
- [x] Focused tests, typecheck, lint, boundaries, full tests, build, reload, and live error inspection pass.

## Scope and non-goals

In scope:

- Grok Build provider construction, request transforms, model catalog, tests, and durable guidance.

Not in scope:

- Kimi K3.
- Changing xAI API-key provider behavior.
- Installing the `pi-grok-cli` extension runtime into Pivi.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-17 | Implement a dedicated core-owned Grok Build provider using injected Pi engine primitives. | Pivi does not expose the pi extension runtime, and cloning the xAI API provider cannot satisfy subscription endpoint or tool protocol requirements. | WS-01, WS-02 |
| 2026-07-17 | Keep Pivi's existing tool contracts in this model-catalog fix. | Cursor-compatible Grok tool aliases have different schemas and require a separate model-scoped adapter; a string rename would be unsafe and is beyond the requested list/protocol correction. | WS-01 |

## Workstreams

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Grok Build protocol/provider implementation | Codex | Complete | None | Provider/request unit tests |
| WS-02 | Model catalog and settings/runtime integration | Codex | Complete | WS-01 | Registry/UI tests |
| WS-03 | Independent protocol evidence review | grok-protocol-verifier | Complete | None | Upstream/official source comparison |

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run check:boundaries`
- Focused Grok provider and React settings tests
- `npm run test -- --runInBand`
- `npm run build`
- `obsidian plugin:reload id=pivi`
- `obsidian dev:errors`

## Documentation sync

- `docs/08-presentation-settings-and-inline-edit.md`
- `packages/pivi-agent-core/src/engine/pi/AGENTS.md`
- Other nearest guidance only if boundaries change.

## Progress and handoff

### 2026-07-17 — Codex — WS-01

- Changed: Opened the implementation spec after confirming the current provider incorrectly reuses the xAI API catalog and endpoint.
- Evidence: xAI documents `cli-chat-proxy.grok.com` for OAuth inference and `api.x.ai` for direct API-key inference; `pi-grok-cli` documents Composer-specific headers and payload compatibility.
- Remaining: Implementation, tests, documentation, and live validation.
- Blockers: None.
- Next action: Define the minimal dedicated Grok Build provider contract.

### 2026-07-17 — Codex — WS-01

- Changed: Added a dedicated OAuth-only Grok Build provider with a subscription-only static fallback catalog, proxy endpoint, client/model override headers, and Responses payload normalization.
- Evidence: Focused provider/catalog tests pass and source/test typecheck passes.
- Remaining: Full repository gates, build, deploy, reload, and live error inspection.
- Blockers: None.
- Next action: Run repository verification and close the spec.

### 2026-07-17 — Codex — WS-02

- Changed: Installed the Grok Build provider beside the unchanged xAI API-key provider, synchronized durable guidance, and added independent catalog regression coverage.
- Evidence: `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and all 252 suites / 1,932 tests passed. `npm run build` deployed the production plugin, `obsidian plugin:reload id=pivi` reloaded it, and `obsidian dev:errors` reported `No errors captured.`
- Remaining: None for the requested Grok Build model-list and inference-protocol fix.
- Blockers: None.
- Next action: Archive this completed spec.

## Completion summary

Grok Build now has an OAuth-only provider and catalog independent from the xAI API-key provider. Composer 2.5 Fast is available with its account metadata, routes through the OAuth inference proxy with the required client/model headers, and receives a proxy-compatible Responses payload. Kimi K3 and model-scoped Cursor tool adapters remain outside this request.

### 2026-07-17 — grok-protocol-verifier — WS-03

- Scope: Read-only comparison of the current Pivi split-provider implementation, xAI's public Grok Build documentation/current official source, and the published `pi-grok-cli@0.5.0` source (`gitHead` `cd403c02f8c7e5c95dd54d35c30bd29919b8a2c2`). No product source was changed.
- Primary evidence:
  - xAI's enterprise documentation identifies `cli-chat-proxy.grok.com` as the OAuth inference/settings host and `api.x.ai` as the separate API-key path: <https://docs.x.ai/build/enterprise>.
  - The official Grok Build source's direct-proxy example states that bearer auth, `X-XAI-Token-Auth: xai-grok-cli`, and `x-grok-model-override` are the routing contract; the body model is not the authoritative router. The override is optional only for the default `grok-build` route, so it is mandatory for `grok-composer-2.5-fast`: <https://github.com/xai-org/grok-build/blob/c68e39f60462f28d9be5e683d9cbe2c57b1a5027/crates/codegen/xai-grok-shell/README.md#using-authjson-for-api-access>.
  - The official sampler supports the Responses backend at `/v1/responses`, always emits per-request model/conversation IDs, and emits Grok client identity/version headers: <https://github.com/xai-org/grok-build/blob/c68e39f60462f28d9be5e683d9cbe2c57b1a5027/crates/codegen/xai-grok-sampler/src/client.rs>.
  - `pi-grok-cli@0.5.0` uses `https://cli-chat-proxy.grok.com/v1`, registers `grok-composer-2.5-fast` as a text-only, non-reasoning `openai-responses` model with a 200,000-token context window and 30,000 max output tokens, and installs the model override on every model request: <https://github.com/kenryu42/pi-grok-cli/blob/v0.5.0/src/auth/config.ts>, <https://github.com/kenryu42/pi-grok-cli/blob/v0.5.0/src/models/catalog.ts>, <https://github.com/kenryu42/pi-grok-cli/blob/v0.5.0/src/provider/stream.ts>.
  - Its request sanitizer records proxy-observed incompatibilities and its provider registers Cursor-compatible tool names only for `grok-build` and `grok-composer-2.5-fast`: <https://github.com/kenryu42/pi-grok-cli/blob/v0.5.0/src/payload/sanitize.ts>, <https://github.com/kenryu42/pi-grok-cli/blob/v0.5.0/src/provider/toolScope.ts>.
- Minimum inference protocol — strictly required:
  1. Route the subscription model to `https://cli-chat-proxy.grok.com/v1`, not `https://api.x.ai/v1`; with Pivi's selected transport, stream `POST /responses` and keep `stream: true`.
  2. Resolve the subscription OAuth access token into `Authorization: Bearer <access>` and send `X-XAI-Token-Auth: xai-grok-cli`.
  3. Send `x-grok-model-override: grok-composer-2.5-fast` on every request. Do not rely on the JSON `model` field for backend routing.
  4. Send an accepted Grok client version. Both compared clients provide `x-grok-client-version`; `pi-grok-cli@0.5.0` additionally supplies the version-bearing Grok `User-Agent` because an observed proxy gate returned HTTP 426 when the version was absent. For a robust implementation, treat the version header and version-bearing user agent as a required pair and cover them in request tests.
  5. Register Composer as `reasoning: false`, `input: ['text']`, context `200_000`, max output `30_000`, with every thinking level disabled/null. This prevents pi-ai from generating unsupported `reasoning`/encrypted-reasoning parameters.
  6. Before dispatch, move any `system` or `developer` input items into top-level `instructions`; the proxy rejects those roles inside the Responses `input` array. This transformation is required with pi-ai 0.80.8 because its non-reasoning Responses conversion currently emits the Pivi system prompt as an `input` item with role `system`.
  7. Ensure `prompt_cache_retention` is absent. Pivi can satisfy this without a broad sanitizer by setting `compat.supportsLongCacheRetention: false`; `prompt_cache_key` itself is accepted and may remain.
- Request hardening — conditional rather than required for Pivi's correctly declared Composer model:
  - Strip replayed `reasoning` input items and remove `reasoning`, `reasoningEffort`, plus `reasoning.encrypted_content` includes if they appear. Correct non-reasoning metadata prevents new values, but stripping protects resumed/imported histories.
  - Filter empty-string content. The normal Pivi turn path does not submit an empty user turn, so this is defensive.
  - `response_format -> text.format` is needed only if a caller supplies `response_format`; the current Pivi/pi-ai request builder does not.
  - Image normalization and `function_call_output` image extraction are not needed for Composer in Pivi: declaring it text-only makes pi-ai downgrade user/tool images to text placeholders before building the Responses payload. Do not advertise image input merely to exercise those transforms.
- Headers that are useful but not demonstrated as minimum inference requirements by both compared clients:
  - `x-grok-client-identifier` and `x-grok-conv-id` are sent by both for observability/session affinity; include stable Pivi values when practical, but auth and model routing do not depend on them according to the public direct-proxy contract.
  - Current official source also injects `x-authenticateresponse: authenticate-response` and `x-grok-client-mode`; these are newer than `pi-grok-cli@0.5.0` and absent from xAI's published curl minimum. They are forward-parity headers, not evidence-backed blockers for the current minimal implementation.
- Tool-name compatibility:
  - Text-only inference does not require Cursor aliases. A reliable Composer coding-agent loop does: `pi-grok-cli@0.5.0` deliberately swaps only Composer/`grok-build` to `Read`, `Write`, `Edit`, `StrReplace`, `Grep`, `Glob`, `LS`, `Shell`, and optional `Delete`/`WebSearch`, while restoring native names for other models.
  - Pivi must not perform a string-only rename. Cursor aliases have different argument contracts, so each exposed compatibility name needs a model-scoped adapter that validates/translates arguments and delegates to the corresponding Pivi tool operation, then preserves the alias name in tool-call/result replay. At minimum, read/search/list plus edit/write/delete aliases are needed for the vault agent loop; `Shell` must remain conditional on Pivi's Bash policy, and `WebSearch` is optional.
  - If WS-01 intentionally omits these adapters, document Composer as text/prompt capable but not yet tool-loop compatible rather than claiming full agent compatibility.
- Current Pivi gap: `createSubscriptionOAuthProvider(xaiProvider(), ...)` still clones xAI API models and dispatches through the backing xAI provider, so it satisfies none of the endpoint, Composer catalog, model-override, or payload requirements above. The OAuth credential slot separation itself is correct and should be retained.
- Suggested focused verification:
  - Assert Composer metadata and independent provider ID/catalog.
  - Capture the actual `/responses` request and assert proxy base URL, bearer token, `X-XAI-Token-Auth`, model override, client version/user agent, streaming, top-level `instructions`, no system/developer input, no reasoning fields/include, and no `prompt_cache_retention`.
  - Exercise a second turn with a tool result and verify the compatibility alias survives request, returned tool call, execution, and replay; verify non-Composer and xAI API-key models retain native Pivi tool names and `api.x.ai` behavior.
- Blockers: None for inference/catalog. Full Composer tool-loop parity requires explicit compatibility adapters rather than provider-only model-list work.
- Next action: WS-01 should implement the dedicated Responses provider and request tests first, then either include the scoped tool adapters or narrow the success criterion before completion.
