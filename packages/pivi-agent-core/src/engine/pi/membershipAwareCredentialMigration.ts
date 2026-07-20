import type { CustomProviderConfig } from '../../foundation/customProviders';
import type { SyncSecretStore } from '../../ports';
import {
  migratePiProviderCredentialsToKeychain,
  migrateSplitSubscriptionOAuthCredentials,
} from './piProviderCredentialStore';

export interface LegacyProviderMembershipSnapshot {
  addedProviders: readonly string[];
  disabledProviders: readonly string[];
  environmentVariables: string;
  visibleModels: readonly string[];
  model: string;
  titleGenerationModel: string;
  lastModel?: string;
  customProviders: readonly CustomProviderConfig[];
}

export interface MembershipAwareCredentialMigrationResult {
  membership: LegacyProviderMembershipSnapshot;
  changed: boolean;
  migratedPiProviderIds: readonly string[];
}

function rewriteModelKey(
  modelKey: string,
  providerRewrites: ReadonlyMap<string, string>,
  ambiguousProviderSplits: ReadonlySet<string>,
): string {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex < 1) {
    return modelKey;
  }
  const providerId = modelKey.substring(0, slashIndex);
  if (ambiguousProviderSplits.has(providerId)) {
    return modelKey;
  }
  const nextProviderId = providerRewrites.get(providerId);
  return nextProviderId
    ? `${nextProviderId}${modelKey.substring(slashIndex)}`
    : modelKey;
}

function toSubscriptionModelKey(
  modelKey: string,
  providerRewrites: ReadonlyMap<string, string>,
): string {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex < 1) {
    return modelKey;
  }
  const providerId = modelKey.substring(0, slashIndex);
  const nextProviderId = providerRewrites.get(providerId);
  return nextProviderId
    ? `${nextProviderId}${modelKey.substring(slashIndex)}`
    : modelKey;
}

/**
 * Canonicalize legacy credentials and rewrite model namespaces using raw legacy
 * membership as provenance. Credential presence alone never adds providers;
 * subscription OAuth expands membership only when the paired API provider is
 * already registered.
 */
export function migrateMembershipAwareProviderSecrets(
  secretStorage: SyncSecretStore,
  legacy: LegacyProviderMembershipSnapshot,
): MembershipAwareCredentialMigrationResult {
  const preSplit = migrateSplitSubscriptionOAuthCredentials(
    secretStorage,
    legacy.addedProviders,
  );
  const synced = migratePiProviderCredentialsToKeychain(
    secretStorage,
    preSplit.addedProviders,
    legacy.environmentVariables,
  );
  const postSplit = migrateSplitSubscriptionOAuthCredentials(
    secretStorage,
    synced.addedProviders,
  );

  const migratedPiProviderIds = [
    ...new Set([
      ...preSplit.migratedPiProviderIds,
      ...postSplit.migratedPiProviderIds,
    ]),
  ];

  const providerRewrites = new Map<string, string>();
  const ambiguousProviderSplits = new Set<string>();
  if (migratedPiProviderIds.includes('xai')) {
    providerRewrites.set('xai', 'grok-build');
    if (
      legacy.addedProviders.includes('xai')
      && legacy.addedProviders.includes('grok-build')
    ) {
      ambiguousProviderSplits.add('xai');
    }
  }
  if (migratedPiProviderIds.includes('anthropic')) {
    providerRewrites.set('anthropic', 'claude');
    if (
      legacy.addedProviders.includes('anthropic')
      && legacy.addedProviders.includes('claude')
    ) {
      ambiguousProviderSplits.add('anthropic');
    }
  }

  const visibleModels = legacy.visibleModels.map((modelKey) =>
    rewriteModelKey(modelKey, providerRewrites, ambiguousProviderSplits));
  for (const modelKey of legacy.visibleModels) {
    const providerId = modelKey.substring(0, modelKey.indexOf('/'));
    if (ambiguousProviderSplits.has(providerId)) {
      visibleModels.push(toSubscriptionModelKey(modelKey, providerRewrites));
    }
  }

  const nextDisabledProviders = legacy.disabledProviders.flatMap((providerId) => {
    const replacement = providerRewrites.get(providerId);
    return replacement && !ambiguousProviderSplits.has(providerId)
      ? [replacement]
      : [providerId];
  });

  const titleGenerationModel = typeof legacy.titleGenerationModel === 'string'
    ? legacy.titleGenerationModel
    : '';
  const lastModel = typeof legacy.lastModel === 'string' ? legacy.lastModel : undefined;

  const membership: LegacyProviderMembershipSnapshot = {
    ...legacy,
    addedProviders: postSplit.addedProviders,
    disabledProviders: [...new Set(nextDisabledProviders)],
    environmentVariables: synced.environmentVariables,
    visibleModels: [...new Set(visibleModels)],
    model: rewriteModelKey(legacy.model, providerRewrites, ambiguousProviderSplits),
    titleGenerationModel: rewriteModelKey(
      titleGenerationModel,
      providerRewrites,
      ambiguousProviderSplits,
    ),
    ...(lastModel
      ? {
          lastModel: rewriteModelKey(
            lastModel,
            providerRewrites,
            ambiguousProviderSplits,
          ),
        }
      : {}),
  };

  return {
    membership,
    changed: preSplit.changed || synced.changed || postSplit.changed,
    migratedPiProviderIds,
  };
}
