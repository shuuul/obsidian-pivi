import type ObsiusPlugin from '../../main';
import { parseEnvironmentVariables } from '../../utils/env';
import { maybeGetPiWorkspaceServices } from '../app/PiWorkspaceServices';
import { credentialToApiKey } from '../auth/ObsidianCredentialStore';
import { getProviderEnvVarNames } from '../auth/providerEnvVars';
import { CODEX_OAUTH_PROVIDER_ID } from '../auth/ProviderOAuthService';
import {
  isProviderDisabled,
  resolveProviderCredentialFromKeychain,
} from '../auth/ProviderSecretStorage';
import { getPiAgentSettings, isValidModelKey } from '../settings';
import { type PiResolvedModel, resolvePiModelFromKey } from './resolvePiModelFromKey';

const PI_FALLBACK_MODEL_KEY = 'opencode-go/deepseek-v4-flash';

export function resolvePiModel(plugin: ObsiusPlugin, modelKey?: string): PiResolvedModel | null {
  const preferredKey = modelKey?.trim() || plugin.settings.model;

  if (preferredKey && isValidModelKey(preferredKey)) {
    const resolved = getModelByKey(preferredKey);
    if (resolved) return resolved;
  }

  const piSettings = getPiAgentSettings(plugin.settings);
  for (const visibleKey of piSettings.visibleModels) {
    const resolved = getModelByKey(visibleKey);
    if (resolved) return resolved;
  }

  return getModelByKey(PI_FALLBACK_MODEL_KEY);
}

export function resolvePiApiKey(plugin: ObsiusPlugin, provider: string): string | undefined {
  const piSettings = getPiAgentSettings(plugin.settings);
  if (isProviderDisabled(piSettings.disabledProviders, provider)) {
    return undefined;
  }

  if (provider === CODEX_OAUTH_PROVIDER_ID) {
    const codexToken = maybeGetPiWorkspaceServices()?.providerOAuth?.getCodexAccessTokenSync();
    if (codexToken) {
      return codexToken;
    }
  }

  const credential = maybeGetPiWorkspaceServices()?.credentialStore?.readSync(provider);
  const credentialKey = credentialToApiKey(credential);
  if (credentialKey) {
    return credentialKey;
  }

  const keychainValue = resolveProviderCredentialFromKeychain(
    plugin.app.secretStorage,
    provider,
    getProviderEnvVarNames(provider),
  );
  if (keychainValue) {
    return keychainValue;
  }

  const parsedEnv = parseEnvironmentVariables(piSettings.environmentVariables);
  const parsedSharedEnv = parseEnvironmentVariables(plugin.settings.sharedEnvironmentVariables);
  const envVars = getProviderEnvVarNames(provider);
  const envKeys = envVars.oauthVar
    ? [envVars.apiKeyVar, envVars.oauthVar]
    : [envVars.apiKeyVar];

  for (const key of envKeys) {
    const value = parsedEnv[key] ?? parsedSharedEnv[key] ?? process.env[key];
    if (value) return value;
  }

  return undefined;
}

function getModelByKey(key: string): PiResolvedModel | null {
  try {
    return resolvePiModelFromKey(key);
  } catch {
    return null;
  }
}
