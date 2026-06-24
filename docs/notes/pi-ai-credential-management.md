# pi-ai credential management follow-up

> Date: 2026-06-23  
> Status: partial migration note

`@earendil-works/pi-ai@0.80.x` introduced provider-owned auth resolution through `Models`, injectable `CredentialStore`, and injectable `AuthContext` for environment/file lookup. Obsius now partially uses that surface, while retaining compatibility credential resolution for the Pi agent runtime.

## Current state

Obsius has migrated the model catalog/auth plumbing enough for pi-ai provider APIs to see Obsidian-backed credential services:

- `src/pi/auth/ObsidianCredentialStore.ts` implements pi-ai `CredentialStore` over Obsidian SecretStorage.
- `src/pi/app/PiWorkspaceServices.ts` creates the credential store and an Obsidian-safe `AuthContext`, then calls `configurePiAiModels({ credentials, authContext })`.
- `src/pi/piAiModels.ts` constructs the shared `Models` collection with those injected services and registers only supported providers.
- Provider settings UI still owns user-facing credential controls and status.

Compatibility path still remains:

- `src/pi/runtime/piModelEnv.ts` resolves keys from Obsius settings/keychain/environment snippets.
- `PiChatRuntime` and `PiAuxQueryRunner` still pass credentials to `pi-agent-core` through `Agent.getApiKey` for runtime compatibility.
- Existing keychain IDs are preserved so users do not need to re-enter credentials.

This hybrid state preserves existing user settings and avoids forcing users to re-enter provider credentials during the `pi-ai@0.80.x` API migration.

## Remaining direction

Move provider credential ownership to pi-ai where practical:

1. Replace or narrow ad-hoc `Agent.getApiKey` resolution with `Models.getAuth()` / provider-owned request auth where the agent runtime supports it.
2. Confirm OAuth refresh writes happen through `CredentialStore.modify()` for every provider that supports refresh.
3. Keep legacy keychain entry compatibility or add a one-time migration into pi-ai's provider-scoped credential shape without requiring user action.
4. Document which ambient filesystem credentials are supported by `AuthContext` on desktop and which remain opt-in/disabled in Obsidian.

## Caveats

- Obsius must preserve existing keychain IDs or provide a one-time migration.
- OAuth providers need careful refresh semantics; pi-ai expects refresh writes to happen inside `CredentialStore.modify()`.
- Browser/Electron constraints still matter: ambient filesystem credentials such as AWS profiles or gcloud ADC should be opt-in and desktop-safe.
- Settings UI should continue to show provider configuration status even if pi-ai owns the underlying credential resolution.

## Related

- [pi-ai provider selection](./pi-ai-provider-selection.md)
- [bundle analysis](./bundle-analysis.md)
