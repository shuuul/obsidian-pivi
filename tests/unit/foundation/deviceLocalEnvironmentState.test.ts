/**
 * Device-local environment registry schema, projection, and classification tests.
 */

import {
  buildEntriesFromLegacyText,
  classifyImportedEnvironmentKey,
  createEmptyDeviceLocalEnvironmentState,
  createSecretStoreResolveHost,
  extractCanonicalCredentialCandidates,
  formatEnvironmentMap,
  normalizeDeviceLocalEnvironmentState,
  parseEnvironmentImportText,
  projectEnvironmentOntoSettings,
  resolveEnvironmentMap,
  stageEnvironmentSecrets,
  stripEnvironmentFieldsFromPersistedSettings,
  toStoredEnvironmentEntries,
} from '@pivi/pivi-agent-core/foundation/deviceLocalEnvironmentState';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';

function createMemorySecretStore(): SyncSecretStore {
  const secrets = new Map<string, string>();
  return {
    getSecret(key) {
      return secrets.get(key) ?? null;
    },
    setSecret(key, value) {
      if (!value) {
        secrets.delete(key);
        return;
      }
      secrets.set(key, value);
    },
    listSecrets(prefix) {
      return [...secrets.keys()].filter((key) => !prefix || key.startsWith(prefix));
    },
    deleteSecret(key) {
      secrets.delete(key);
    },
  };
}

describe('deviceLocalEnvironmentState', () => {
  it('creates an empty initialized registry', () => {
    expect(createEmptyDeviceLocalEnvironmentState()).toEqual({
      version: 1,
      initialized: true,
      entries: [],
    });
  });

  it('classifies provider and web keys as canonical', () => {
    expect(classifyImportedEnvironmentKey('ANTHROPIC_API_KEY').kind).toBe('canonical-provider');
    expect(classifyImportedEnvironmentKey('BRAVE_API_KEY')).toEqual({
      kind: 'canonical-web',
      webProviderId: 'brave',
    });
    expect(classifyImportedEnvironmentKey('CUSTOM_API_KEY').kind).toBe('secret');
    expect(classifyImportedEnvironmentKey('PATH').kind).toBe('plain');
  });

  it('extracts canonical credentials and leaves remaining text', () => {
    const result = extractCanonicalCredentialCandidates(
      'ANTHROPIC_API_KEY=sk-a\nBRAVE_API_KEY=brave\nPATH=/bin\nCUSTOM_TOKEN=tok',
    );
    expect(result.providerEnv).toEqual({ ANTHROPIC_API_KEY: 'sk-a' });
    expect(result.webCredentials).toEqual([{ providerId: 'brave', apiKey: 'brave' }]);
    expect(result.remainingText).toContain('PATH=/bin');
    expect(result.remainingText).toContain('CUSTOM_TOKEN=tok');
    expect(result.remainingText).not.toContain('ANTHROPIC_API_KEY');
  });

  it('parses import text into secret and plain drafts', () => {
    const drafts = parseEnvironmentImportText('PATH=/bin\nMY_TOKEN=secret', 'shared');
    expect(drafts).toEqual([
      { key: 'PATH', scope: 'shared', source: { kind: 'plain', value: '/bin' } },
      { key: 'MY_TOKEN', scope: 'shared', source: { kind: 'secret', value: 'secret' } },
    ]);
  });

  it('stages secrets then stores refs without plaintext secret values', () => {
    const store = createMemorySecretStore();
    const drafts = buildEntriesFromLegacyText('PATH=/bin\nMY_TOKEN=sekrit', '');
    const staged = stageEnvironmentSecrets(store, drafts, null);
    expect(staged.nextState.entries).toEqual([
      { key: 'PATH', scope: 'shared', source: { kind: 'plain', value: '/bin' } },
      { key: 'MY_TOKEN', scope: 'shared', source: { kind: 'secret' } },
    ]);
    expect(Object.values(Object.fromEntries(
      store.listSecrets().map((id) => [id, store.getSecret(id)]),
    )).some((value) => value === 'sekrit')).toBe(true);
  });

  it('rejects secret-like plaintext in stored entries', () => {
    expect(() => toStoredEnvironmentEntries([
      { key: 'MY_TOKEN', scope: 'shared', source: { kind: 'plain', value: 'x' } },
    ])).toThrow(/cannot be saved as plaintext/);
  });

  it('resolves systemEnvironment at runtime without storing the value', () => {
    const state = normalizeDeviceLocalEnvironmentState({
      version: 1,
      initialized: true,
      entries: [
        { key: 'HOME', scope: 'shared', source: { kind: 'systemEnvironment' } },
      ],
    });
    const host = createSecretStoreResolveHost(undefined, (name) => (
      name === 'HOME' ? '/Users/demo' : undefined
    ));
    expect(resolveEnvironmentMap(state, host)).toEqual({ HOME: '/Users/demo' });
    expect(state.entries[0]?.source).toEqual({ kind: 'systemEnvironment' });
  });

  it('projects resolved maps onto runtime settings and strips synced fields', () => {
    const store = createMemorySecretStore();
    const drafts = buildEntriesFromLegacyText('PATH=/bin', 'PI_FLAG=1');
    const staged = stageEnvironmentSecrets(store, drafts, null);
    const settings = {
      ...DEFAULT_PIVI_SETTINGS,
      agentSettings: { ...DEFAULT_PIVI_SETTINGS.agentSettings },
    };
    const host = createSecretStoreResolveHost(store, () => undefined);
    projectEnvironmentOntoSettings(settings, staged.nextState, host);
    expect(settings.sharedEnvironmentVariables).toBe('PATH=/bin');
    expect(settings.agentSettings.environmentVariables).toBe('PI_FLAG=1');

    const persisted = { ...settings } as unknown as Record<string, unknown>;
    stripEnvironmentFieldsFromPersistedSettings(persisted);
    expect(persisted.sharedEnvironmentVariables).toBeUndefined();
    expect((persisted.agentSettings as { environmentVariables?: string }).environmentVariables)
      .toBeUndefined();
  });

  it('formats environment maps stably', () => {
    expect(formatEnvironmentMap({ B: '2', A: '1' })).toBe('B=2\nA=1');
  });
});
