import type { ChatUIOption } from '@pivi/agent/runtime/chatUi';
import type { PiviSettings } from '@pivi/agent/settings';

export interface SettingsCatalogPort {
  listModelsForProvider(providerId: string): ChatUIOption[];
  listCatalogModels(): ChatUIOption[];
  /** Composer model options: checked models of enabled providers, grouped like the input channel. */
  listComposerModelOptions(): ChatUIOption[];
  syncCustomProviders(snapshot: PiviSettings): void;
  fetchCustomProviderModels(
    providerId: string,
    snapshot: PiviSettings,
  ): Promise<{ count: number }>;
}
