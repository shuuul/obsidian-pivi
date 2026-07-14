import type { WebSearchProviderId } from '../../foundation/settings';
import type { SyncSecretStore } from '../../ports';

const WEB_SEARCH_CREDENTIAL_ID_PREFIX = 'pivi-web-search';

export function getWebSearchCredentialSecretId(providerId: WebSearchProviderId): string {
  return `${WEB_SEARCH_CREDENTIAL_ID_PREFIX}-${providerId}-api-key`;
}

function isWebSearchSecretStorageAvailable(
  secretStorage: SyncSecretStore | undefined,
): secretStorage is SyncSecretStore {
  return !!secretStorage
    && typeof secretStorage.getSecret === 'function'
    && typeof secretStorage.setSecret === 'function'
    && typeof secretStorage.listSecrets === 'function';
}

export class WebSearchCredentialStore {
  constructor(private readonly secretStorage: SyncSecretStore) {}

  readSync(providerId: WebSearchProviderId): string | undefined {
    const value = this.secretStorage.getSecret(getWebSearchCredentialSecretId(providerId));
    return value?.trim() || undefined;
  }

  writeSync(providerId: WebSearchProviderId, apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      this.clearSync(providerId);
      return;
    }
    this.secretStorage.setSecret(getWebSearchCredentialSecretId(providerId), trimmed);
  }

  clearSync(providerId: WebSearchProviderId): void {
    const secretId = getWebSearchCredentialSecretId(providerId);
    if (this.secretStorage.deleteSecret) {
      this.secretStorage.deleteSecret(secretId);
      return;
    }
    this.secretStorage.setSecret(secretId, '');
  }
}

export function createWebSearchCredentialStore(
  secretStorage: SyncSecretStore | undefined,
): WebSearchCredentialStore | null {
  if (!isWebSearchSecretStorageAvailable(secretStorage)) {
    return null;
  }
  return new WebSearchCredentialStore(secretStorage);
}
