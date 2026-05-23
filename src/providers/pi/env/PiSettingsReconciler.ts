import type { ProviderSettingsReconciler } from '../../../core/providers/types';

export const piSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(settings, conversations) {
    return { changed: false, invalidatedConversations: [] };
  },
  normalizeModelVariantSettings(settings) {
    return false;
  },
};
