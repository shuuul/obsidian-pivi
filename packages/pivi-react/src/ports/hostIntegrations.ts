import type { PiviSettings } from '@pivi/agent/settings';

import type { SettingsFeedbackMessage } from './feedback';

export interface SettingsHostIntegrationAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface SettingsHostIntegrationSection {
  readonly id: string;
  readonly heading: string;
  readonly description: string;
  readonly actions: readonly SettingsHostIntegrationAction[];
}

/** Host-owned integrations rendered by the product settings shell. */
export interface SettingsHostIntegrationsPort {
  listSections(): readonly SettingsHostIntegrationSection[] | Promise<readonly SettingsHostIntegrationSection[]>;
  runAction(actionId: string): Promise<{ readonly feedback?: SettingsFeedbackMessage }>;
}

/** Persistence helpers for complex settings pages that still project full settings snapshots. */
export interface SettingsPersistencePort {
  getSettingsSnapshot(): PiviSettings;
  commitSettingsSnapshot(snapshot: PiviSettings): Promise<void>;
}
