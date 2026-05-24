# ADR-0008: Pi-only layered architecture (simplified hexagonal)

## Status

Accepted

## Context

Obsius forked from Claudian, which supported multiple agent frameworks (Claude SDK, Codex, OpenCode). The codebase retained hexagonal ceremony (`AgentAdaptor` registration, `RuntimeCapabilities` matrices, Claudian naming) while ADR-0003 already committed to a single Pi runtime (`pi-agent-core`).

Product direction is **Pi-only** for the foreseeable future. We still need:

- `features/` isolated from `pi/` (Obsidian UI vs agent SDK churn)
- `ChatRuntime` and related ports for unit tests (mock runtime) and Pi integration tests
- Clear ownership of install defaults vs runtime normalization (settings 3b)

## Decision

1. **Keep three layers**: `core/` (ports + product domain), `pi/` (Pi adaptor), `features/` (Obsidian UI). This is layered hexagonal, not a pluggable multi-runtime registry.
2. **Pi-only is explicit**: No second agent adaptor in v1; ADR-0003 review item is **won't do** unless product strategy changes.
3. **Bootstrap wiring**: `main.ts` calls `bootstrapPiAgent()` once. `AgentServices.bootstrap(registration)` replaces `install(adaptor)`; `PiAgentRegistration` replaces `AgentAdaptor`.
4. **Settings 3b**: Install defaults live in `core/settings/agentDefaults.ts`. Pi-specific read/merge/sanitize stays in `pi/settings.ts`. `app/settings/` imports defaults from core; may call `getPiAgentSettings` for normalization.
5. **Retain `RuntimeCapabilities`**: Flags remain for UI gating and tests, but describe Pi behavior only—not a future runtime matrix.
6. **Rename Claudian-era types**: `SDKToolUseResult` → `ToolUseResult`; permission sync callback uses `runtimeMode` instead of `sdkMode`.

## Rationale

Removes misleading “swap adaptor” narrative without deleting the valuable `features` ↔ `core` seam or `ChatRuntime` test double.

## Alternatives

1. **Merge `pi/` into `features/`** — fewer folders; couples Obsidian and `pi-agent-core`.
2. **Keep full multi-runtime registry** — boilerplate with no product benefit.
3. **Defaults only in `app/settings/`** — forces `pi/` → `app/` imports; rejected in favor of `core/settings/`.

## Consequences

### Positive

- Clearer mental model for contributors
- Storage tests can use defaults without importing `pi/`
- Dual test strategy unchanged: mock `ChatRuntime` + `tests/unit/pi/`

### Negative / trade-offs

- `AgentServices` remains a static facade (acceptable for Obsidian plugin singleton)
- Large `Tab.ts` / `StreamController.ts` files need ongoing extraction (separate refactors)

### Technical debt

- `reconcileActiveModelFields` keeps `ObsiusSettings.model` and `piSettings.visibleModels[0]` aligned on load and projection; both fields remain on disk for now
- Some comments still say “SDK”; grep and update opportunistically

## Related

- Supersedes narrative in [ADR-0002](./0002-hexagonal-ports-and-adapters.md) (status remains Accepted; scope clarified)
- Extends [ADR-0003](./0003-pi-as-sole-agent-runtime.md)

## Review date

2027-05-01 — only if a second runtime is proposed.
