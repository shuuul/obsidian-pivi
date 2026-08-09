/**
 * Device-local structured environment registry.
 *
 * Authority for environment configuration lives in vault-scoped Obsidian local
 * storage. Secret values are referenced by ID and held only in SecretStorage.
 * Synced `.pivi/settings.json` must never contain environment fields or values.
 */

import { getProviderEnvVarNames } from '../auth/providerEnvVars';
import type { SyncSecretStore } from '../ports';
import {
  assertAllowedSourceForKey,
  clearSecretAcrossIds,
  type ConfigValueDraft,
  type ConfigValueRef,
  configValueRefEquals,
  defaultSourceKindForKey,
  getEnvironmentSecretId,
  isSecretLikeKey,
  listEnvironmentSecretIds,
  normalizeConfigValueRef,
  readSecretAcrossIds,
  resolveConfigValue,
  type ResolveConfigValueHost,
  writeSecretAcrossIds,
} from './configValueSource';
import type { EnvironmentScope, PiviSettings, WebProviderId } from './settings';
import { WEB_PROVIDER_IDS } from './settings';
import { parseEnvironmentVariables } from './settingsEnv';

function webProviderApiKeyEnvVar(providerId: WebProviderId): string {
  if (providerId === 'brave') return 'BRAVE_API_KEY';
  if (providerId === 'tavily') return 'TAVILY_API_KEY';
  if (providerId === 'exa') return 'EXA_API_KEY';
  return 'ANYSEARCH_API_KEY';
}

export const DEVICE_LOCAL_ENVIRONMENT_STATE_VERSION = 1 as const;

export interface DeviceLocalEnvironmentEntryV1 {
  key: string;
  scope: EnvironmentScope;
  source: ConfigValueRef;
}

export interface DeviceLocalEnvironmentStateV1 {
  version: 1;
  initialized: true;
  entries: DeviceLocalEnvironmentEntryV1[];
}

export class DeviceLocalEnvironmentStateVersionError extends Error {
  constructor(readonly unsupportedVersion: unknown) {
    super(`Unsupported device-local environment state version: ${String(unsupportedVersion)}`);
    this.name = 'DeviceLocalEnvironmentStateVersionError';
  }
}

export interface DeviceLocalEnvironmentStore {
  loadInitialized(): DeviceLocalEnvironmentStateV1 | null;
  save(state: DeviceLocalEnvironmentStateV1): void;
  isInitialized(): boolean;
}

export interface EnvironmentEntryDraft {
  key: string;
  scope: EnvironmentScope;
  source: ConfigValueDraft;
}

export interface EnvironmentUiEntry {
  key: string;
  scope: EnvironmentScope;
  sourceKind: ConfigValueRef['kind'];
  /** Plain values only; secrets are never echoed after reload. */
  plainValue?: string;
  /** systemEnvironment override name when different from key. */
  systemName?: string;
  /** Localized storage location hint key suffix. */
  storageLocation: 'deviceLocal' | 'secureStorage' | 'systemEnvironment';
  hasStoredSecret: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || value === 'agent';
}

export function assertSupportedDeviceLocalEnvironmentStateVersion(version: unknown): asserts version is 1 {
  if (version !== 1) {
    throw new DeviceLocalEnvironmentStateVersionError(version);
  }
}

function normalizeEntry(raw: unknown): DeviceLocalEnvironmentEntryV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) {
    return null;
  }
  if (!isEnvironmentScope(raw.scope)) {
    return null;
  }
  const source = normalizeConfigValueRef(raw.source);
  if (!source) {
    return null;
  }
  if (source.kind === 'plain' && isSecretLikeKey(key)) {
    // Persisted local state must not hold secret-like plaintext.
    return null;
  }
  return { key, scope: raw.scope, source };
}

export function normalizeDeviceLocalEnvironmentState(
  raw: unknown,
): DeviceLocalEnvironmentStateV1 {
  if (!isRecord(raw)) {
    return createEmptyDeviceLocalEnvironmentState();
  }
  assertSupportedDeviceLocalEnvironmentStateVersion(raw.version);
  if (raw.initialized !== true) {
    return createEmptyDeviceLocalEnvironmentState();
  }
  const entries: DeviceLocalEnvironmentEntryV1[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.entries) ? raw.entries : [];
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (!entry) {
      continue;
    }
    const id = `${entry.scope}:${entry.key}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    entries.push(entry);
  }
  return {
    version: 1,
    initialized: true,
    entries,
  };
}

export function createEmptyDeviceLocalEnvironmentState(): DeviceLocalEnvironmentStateV1 {
  return {
    version: 1,
    initialized: true,
    entries: [],
  };
}

export function copyDeviceLocalEnvironmentState(
  state: DeviceLocalEnvironmentStateV1,
): DeviceLocalEnvironmentStateV1 {
  return {
    version: 1,
    initialized: true,
    entries: state.entries.map((entry) => ({
      key: entry.key,
      scope: entry.scope,
      source: entry.source.kind === 'plain'
        ? { kind: 'plain', value: entry.source.value }
        : entry.source.kind === 'systemEnvironment'
          ? {
              kind: 'systemEnvironment',
              ...(entry.source.name ? { name: entry.source.name } : {}),
            }
          : { kind: 'secret' },
    })),
  };
}

export function environmentStatesEqual(
  a: DeviceLocalEnvironmentStateV1,
  b: DeviceLocalEnvironmentStateV1,
): boolean {
  if (a.entries.length !== b.entries.length) {
    return false;
  }
  for (let i = 0; i < a.entries.length; i += 1) {
    const left = a.entries[i]!;
    const right = b.entries[i]!;
    if (left.key !== right.key || left.scope !== right.scope) {
      return false;
    }
    if (!configValueRefEquals(left.source, right.source)) {
      return false;
    }
  }
  return true;
}

/** Known provider API/OAuth env var names that belong in canonical credential stores. */
export function getCanonicalProviderEnvironmentKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  const candidateIds = [
    'anthropic',
    'openai',
    'openai-codex',
    'google',
    'google-vertex',
    'amazon-bedrock',
    'azure-openai-responses',
    'xai',
    'grok-build',
    'claude',
    'openrouter',
    'groq',
    'cerebras',
    'mistral',
    'deepseek',
    'zai',
    'minimax',
    'minimax-cn',
    'moonshotai',
    'moonshotai-cn',
    'fireworks',
    'together',
    'opencode',
    'opencode-go',
    'kimi-coding',
    'cloudflare-workers-ai',
    'cloudflare-ai-gateway',
    'xiaomi',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-ams',
    'xiaomi-token-plan-sgp',
    'vercel-ai-gateway',
    'github-copilot',
    'huggingface',
  ];
  for (const providerId of candidateIds) {
    const names = getProviderEnvVarNames(providerId);
    keys.add(names.apiKeyVar);
    if (names.oauthVar) {
      keys.add(names.oauthVar);
    }
  }
  return keys;
}

export function getCanonicalWebEnvironmentKeys(): ReadonlyMap<string, WebProviderId> {
  const map = new Map<string, WebProviderId>();
  for (const providerId of WEB_PROVIDER_IDS) {
    map.set(webProviderApiKeyEnvVar(providerId), providerId);
  }
  return map;
}

export function classifyImportedEnvironmentKey(key: string): {
  kind: 'canonical-provider' | 'canonical-web' | 'secret' | 'plain';
  webProviderId?: WebProviderId;
} {
  const providerKeys = getCanonicalProviderEnvironmentKeys();
  if (providerKeys.has(key)) {
    return { kind: 'canonical-provider' };
  }
  const webKeys = getCanonicalWebEnvironmentKeys();
  const webProviderId = webKeys.get(key);
  if (webProviderId) {
    return { kind: 'canonical-web', webProviderId };
  }
  if (isSecretLikeKey(key) || defaultSourceKindForKey(key) === 'secret') {
    return { kind: 'secret' };
  }
  return { kind: 'plain' };
}

export function parseEnvironmentImportText(
  envText: string,
  defaultScope: EnvironmentScope,
): EnvironmentEntryDraft[] {
  const parsed = parseEnvironmentVariables(envText);
  const drafts: EnvironmentEntryDraft[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const trimmedValue = value.trim();
    if (trimmedValue.startsWith('$') && trimmedValue.length > 1 && !trimmedValue.includes('=')) {
      const systemName = trimmedValue.slice(1).trim();
      drafts.push({
        key,
        scope: defaultScope,
        source: systemName && systemName !== key
          ? { kind: 'systemEnvironment', name: systemName }
          : { kind: 'systemEnvironment' },
      });
      continue;
    }
    const classification = classifyImportedEnvironmentKey(key);
    if (classification.kind === 'canonical-provider' || classification.kind === 'canonical-web') {
      // Caller migrates these to credential stores; they do not become env entries.
      continue;
    }
    if (classification.kind === 'secret') {
      drafts.push({
        key,
        scope: defaultScope,
        source: { kind: 'secret', value },
      });
      continue;
    }
    drafts.push({
      key,
      scope: defaultScope,
      source: { kind: 'plain', value },
    });
  }
  return drafts;
}

export function extractCanonicalCredentialCandidates(
  envText: string,
): {
  providerEnv: Record<string, string>;
  webCredentials: Array<{ providerId: WebProviderId; apiKey: string }>;
  remainingText: string;
} {
  const parsed = parseEnvironmentVariables(envText);
  const providerKeys = getCanonicalProviderEnvironmentKeys();
  const webKeys = getCanonicalWebEnvironmentKeys();
  const providerEnv: Record<string, string> = {};
  const webCredentials: Array<{ providerId: WebProviderId; apiKey: string }> = [];
  const remaining: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (providerKeys.has(key)) {
      providerEnv[key] = trimmed;
      continue;
    }
    const webProviderId = webKeys.get(key);
    if (webProviderId) {
      webCredentials.push({ providerId: webProviderId, apiKey: trimmed });
      continue;
    }
    remaining[key] = value;
  }

  const remainingText = Object.entries(remaining)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  return { providerEnv, webCredentials, remainingText };
}

export function buildEntriesFromLegacyText(
  sharedText: string,
  agentText: string,
): EnvironmentEntryDraft[] {
  return [
    ...parseEnvironmentImportText(sharedText, 'shared'),
    ...parseEnvironmentImportText(agentText, 'agent'),
  ];
}

export function toStoredEnvironmentEntries(
  drafts: readonly EnvironmentEntryDraft[],
): DeviceLocalEnvironmentEntryV1[] {
  const entries: DeviceLocalEnvironmentEntryV1[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!key) {
      continue;
    }
    assertAllowedSourceForKey(key, draft.source);
    const id = `${draft.scope}:${key}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (draft.source.kind === 'plain') {
      entries.push({ key, scope: draft.scope, source: { kind: 'plain', value: draft.source.value } });
    } else if (draft.source.kind === 'secret') {
      entries.push({ key, scope: draft.scope, source: { kind: 'secret' } });
    } else {
      const name = draft.source.name?.trim();
      entries.push({
        key,
        scope: draft.scope,
        source: name ? { kind: 'systemEnvironment', name } : { kind: 'systemEnvironment' },
      });
    }
  }
  return entries;
}

export function stageEnvironmentSecrets(
  secretStorage: SyncSecretStore,
  drafts: readonly EnvironmentEntryDraft[],
  previous: DeviceLocalEnvironmentStateV1 | null,
): {
  nextState: DeviceLocalEnvironmentStateV1;
  stagedSecretIds: string[];
  obsoleteSecretIds: string[];
} {
  const nextEntries = toStoredEnvironmentEntries(drafts);
  const nextState: DeviceLocalEnvironmentStateV1 = {
    version: 1,
    initialized: true,
    entries: nextEntries,
  };
  const stagedSecretIds: string[] = [];
  const nextSecretKeys = new Set<string>();

  for (const draft of drafts) {
    if (draft.source.kind !== 'secret') {
      continue;
    }
    const secretIds = listEnvironmentSecretIds(draft.scope, draft.key.trim());
    const canonical = secretIds[0]!;
    nextSecretKeys.add(`${draft.scope}:${draft.key.trim()}`);
    if (typeof draft.source.value === 'string' && draft.source.value.length > 0) {
      writeSecretAcrossIds(secretStorage, secretIds, draft.source.value);
      stagedSecretIds.push(canonical);
    } else {
      // Keep existing secret if present; require a stored value for new secrets.
      const existing = readSecretAcrossIds(secretStorage, secretIds);
      if (!existing) {
        throw new Error(`Secret-like key "${draft.key}" requires a value in secure storage.`);
      }
    }
  }

  const obsoleteSecretIds: string[] = [];
  for (const previousEntry of previous?.entries ?? []) {
    if (previousEntry.source.kind !== 'secret') {
      continue;
    }
    const id = `${previousEntry.scope}:${previousEntry.key}`;
    if (nextSecretKeys.has(id)) {
      continue;
    }
    for (const secretId of listEnvironmentSecretIds(previousEntry.scope, previousEntry.key)) {
      obsoleteSecretIds.push(secretId);
    }
  }

  return { nextState, stagedSecretIds, obsoleteSecretIds };
}

export function clearObsoleteEnvironmentSecrets(
  secretStorage: SyncSecretStore,
  obsoleteSecretIds: readonly string[],
): void {
  clearSecretAcrossIds(secretStorage, obsoleteSecretIds);
}

export function resolveEnvironmentMap(
  state: DeviceLocalEnvironmentStateV1,
  host: ResolveConfigValueHost,
  scope?: EnvironmentScope,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of state.entries) {
    if (scope && entry.scope !== scope) {
      continue;
    }
    const secretId = getEnvironmentSecretId(entry.scope, entry.key);
    const value = resolveConfigValue(entry.source, secretId, host, entry.key);
    if (typeof value === 'string') {
      result[entry.key] = value;
    }
  }
  return result;
}

export function formatEnvironmentMap(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function projectEnvironmentOntoSettings(
  settings: PiviSettings,
  state: DeviceLocalEnvironmentStateV1,
  host: ResolveConfigValueHost,
): void {
  const shared = resolveEnvironmentMap(state, host, 'shared');
  const agent = resolveEnvironmentMap(state, host, 'agent');
  settings.sharedEnvironmentVariables = formatEnvironmentMap(shared);
  settings.agentSettings = {
    ...settings.agentSettings,
    environmentVariables: formatEnvironmentMap(agent),
  };
}

export function stripEnvironmentFieldsFromPersistedSettings(
  settings: Record<string, unknown>,
): void {
  delete settings.sharedEnvironmentVariables;
  delete settings.environmentVariables;
  const agentSettings = settings.agentSettings;
  if (agentSettings && typeof agentSettings === 'object' && !Array.isArray(agentSettings)) {
    const next = { ...(agentSettings as Record<string, unknown>) };
    delete next.environmentVariables;
    settings.agentSettings = next;
  }
}

export function hasPersistedEnvironmentFields(settings: Record<string, unknown>): boolean {
  if (typeof settings.sharedEnvironmentVariables === 'string'
    && settings.sharedEnvironmentVariables.length > 0) {
    return true;
  }
  if (typeof settings.environmentVariables === 'string'
    && settings.environmentVariables.length > 0) {
    return true;
  }
  const agentSettings = settings.agentSettings;
  if (agentSettings && typeof agentSettings === 'object' && !Array.isArray(agentSettings)) {
    const env = (agentSettings as { environmentVariables?: unknown }).environmentVariables;
    if (typeof env === 'string' && env.length > 0) {
      return true;
    }
  }
  return false;
}

export function toEnvironmentUiEntries(
  state: DeviceLocalEnvironmentStateV1,
  secretStorage: SyncSecretStore | undefined,
): EnvironmentUiEntry[] {
  return state.entries.map((entry) => {
    const hasStoredSecret = entry.source.kind === 'secret'
      && !!secretStorage
      && !!readSecretAcrossIds(secretStorage, listEnvironmentSecretIds(entry.scope, entry.key));
    return {
      key: entry.key,
      scope: entry.scope,
      sourceKind: entry.source.kind,
      plainValue: entry.source.kind === 'plain' ? entry.source.value : undefined,
      systemName: entry.source.kind === 'systemEnvironment' ? entry.source.name : undefined,
      storageLocation: entry.source.kind === 'secret'
        ? 'secureStorage'
        : entry.source.kind === 'systemEnvironment'
          ? 'systemEnvironment'
          : 'deviceLocal',
      hasStoredSecret,
    };
  });
}

export function createSecretStoreResolveHost(
  secretStorage: SyncSecretStore | undefined,
  getSystemEnvironmentVariable: (name: string) => string | undefined,
): ResolveConfigValueHost {
  return {
    getSecret(secretId) {
      return secretStorage?.getSecret(secretId) ?? null;
    },
    getSystemEnvironmentVariable,
  };
}
