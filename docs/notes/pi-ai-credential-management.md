# pi-ai credential management follow-up

> Date: 2026-06-23  
> Status: future migration note

`@earendil-works/pi-ai@0.80.x` introduced provider-owned auth resolution through `Models`, injectable `CredentialStore`, and injectable `AuthContext` for environment/file lookup. Obsius has not migrated credential ownership to pi-ai yet.

## Current state

Obsius still owns provider credentials:

- API keys and OAuth tokens are stored in Obsidian keychain / SecretStorage through the existing provider settings UI.
- `src/pi/runtime/piModelEnv.ts` resolves keys from Obsius settings/keychain.
- `PiChatRuntime` and `PiAuxQueryRunner` pass credentials to `pi-agent-core` through `Agent.getApiKey`.
- The shared `piAiModels` collection currently uses pi-ai provider catalogs and stream routing, but not pi-ai persistent credential storage.

This preserves existing user settings and avoids forcing users to re-enter provider credentials during the `pi-ai@0.80.x` API migration.

## Future direction

Move provider credential ownership to pi-ai where practical:

1. Implement an Obsidian-backed `CredentialStore` adapter over `app.secretStorage`.
2. Implement an Obsidian-safe `AuthContext` that reads Obsius environment snippets and avoids unsafe desktop filesystem assumptions where needed.
3. Construct `piAiModels` with `{ credentials, authContext }`.
4. Replace ad-hoc `Agent.getApiKey` resolution with `Models.getAuth()` / provider-owned request auth where the agent runtime supports it.
5. Migrate existing Obsius keychain entries into pi-ai's provider-scoped credential shape without requiring user action.

## Caveats

- Obsius must preserve existing keychain IDs or provide a one-time migration.
- OAuth providers need careful refresh semantics; pi-ai expects refresh writes to happen inside `CredentialStore.modify()`.
- Browser/Electron constraints still matter: ambient filesystem credentials such as AWS profiles or gcloud ADC should be opt-in and desktop-safe.
- Settings UI should continue to show provider configuration status even if pi-ai owns the underlying credential resolution.

## Related

- [pi-ai provider selection](./pi-ai-provider-selection.md)
- [bundle analysis](./bundle-analysis.md)
