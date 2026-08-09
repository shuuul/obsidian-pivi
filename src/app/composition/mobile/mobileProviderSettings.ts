import { activeProviderId } from './mobileProviderPolicy';
import type { MobileWorkspace } from './MobileWorkspace';

export interface MobileProviderSettingsInput {
  providerId: string;
  modelId: string;
  apiKey: string;
}

export type MobileProviderSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * SecretStorage write first, then non-secret provider state.
 * Never retains the API key on the workspace after return.
 */
export function saveMobileProviderSettings(
  workspace: MobileWorkspace,
  input: MobileProviderSettingsInput,
): MobileProviderSettingsResult {
  const providerId = input.providerId.trim();
  const modelId = input.modelId.trim();
  const apiKey = input.apiKey.trim();
  if (!providerId) return { ok: false, error: 'Provider is required.' };
  if (!modelId) return { ok: false, error: 'Model is required.' };
  if (!apiKey) return { ok: false, error: 'API key is required.' };

  const previousState = workspace.providers.loadInitialized();
  const previousProviderId = activeProviderId(previousState);
  const previousDestinationCredential = workspace.readCredential(providerId);

  try {
    workspace.setApiKey(providerId, apiKey);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Secure storage is unavailable.',
    };
  }

  try {
    workspace.configureProvider(providerId, modelId);
  } catch (error) {
    try {
      workspace.restoreCredential(providerId, previousDestinationCredential);
    } catch {
      // The structured publication failure remains the primary UI error.
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Provider settings could not be saved.',
    };
  }
  workspace.invalidateRuntimes();
  workspace.notifySurfacesChanged();
  if (previousProviderId && previousProviderId !== providerId) {
    workspace.deleteApiKey(previousProviderId);
  }
  return { ok: true };
}

export function deleteMobileProviderKey(
  workspace: MobileWorkspace,
  providerId: string,
): MobileProviderSettingsResult {
  const id = providerId.trim();
  if (!id) return { ok: false, error: 'Provider is required.' };
  const activeProvider = activeProviderId(workspace.providers.loadInitialized());
  if (activeProvider !== id) return { ok: false, error: 'Only the active provider credential can be deleted.' };
  workspace.deleteApiKey(activeProvider);
  workspace.invalidateRuntimes();
  workspace.notifySurfacesChanged();
  return { ok: true };
}
