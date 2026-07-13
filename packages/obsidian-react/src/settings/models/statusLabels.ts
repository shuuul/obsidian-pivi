import type { AppModelReadinessStatusKind } from '@pivi/pivi-agent-core/foundation/modelReadiness';

import type { TranslationKey } from '../../i18n';

export const STATUS_LABEL_KEYS: Record<AppModelReadinessStatusKind, TranslationKey> = {
  ready: 'settings.modelsTab.status.ready',
  'missing-credential': 'settings.modelsTab.status.missingCredential',
  'oauth-expired': 'settings.modelsTab.status.oauthExpired',
  disabled: 'settings.modelsTab.status.disabled',
  unavailable: 'settings.modelsTab.status.unavailable',
};

export const STATUS_DESC_KEYS: Record<AppModelReadinessStatusKind, TranslationKey> = {
  ready: 'settings.modelsTab.statusDesc.ready',
  'missing-credential': 'settings.modelsTab.statusDesc.missingCredential',
  'oauth-expired': 'settings.modelsTab.statusDesc.oauthExpired',
  disabled: 'settings.modelsTab.statusDesc.disabled',
  unavailable: 'settings.modelsTab.statusDesc.unavailable',
};
