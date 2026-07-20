import {
  writeCustomProviderHeaders,
} from '@pivi/pivi-agent-core/auth/customProviderHeaderSecrets';
import type { CustomProviderConfig } from '@pivi/pivi-agent-core/foundation/customProviders';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';

export class CustomProviderHeaderMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomProviderHeaderMigrationError';
  }
}

function normalizeHeaderMap(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedName || !trimmedValue) {
      continue;
    }
    normalized[trimmedName] = trimmedValue;
  }
  return normalized;
}

export function stripHeadersFromCustomProviders(
  customProviders: readonly CustomProviderConfig[],
): CustomProviderConfig[] {
  return customProviders.map((provider) => {
    const { headers: _headers, ...withoutHeaders } = provider;
    return { ...withoutHeaders };
  });
}

/**
 * Move custom provider header maps into SecretStorage. Source configs are
 * returned without headers only after all required writes succeed.
 */
export function migrateCustomProviderHeadersToSecretStorage(
  secretStorage: SyncSecretStore,
  customProviders: readonly CustomProviderConfig[],
): CustomProviderConfig[] {
  const migrated: CustomProviderConfig[] = [];

  for (const provider of customProviders) {
    const headers = normalizeHeaderMap(provider.headers);
    if (Object.keys(headers).length > 0) {
      try {
        writeCustomProviderHeaders(secretStorage, provider.id, headers);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CustomProviderHeaderMigrationError(
          `Failed to migrate custom provider headers for "${provider.id}": ${message}`,
        );
      }
    }
    const { headers: _headers, ...withoutHeaders } = provider;
    migrated.push({ ...withoutHeaders });
  }

  return migrated;
}
