import type { EnvironmentScope } from '@pivi/agent/settings/types';

export interface SettingsEnvironmentEntryView {
  readonly key: string;
  readonly scope: EnvironmentScope;
  readonly sourceKind: 'plain' | 'secret' | 'systemEnvironment';
  readonly plainValue?: string;
  readonly systemName?: string;
  readonly storageLocation: 'deviceLocal' | 'secureStorage' | 'systemEnvironment';
  readonly hasStoredSecret: boolean;
}

export interface SettingsEnvironmentPort {
  getActiveEnvironmentVariables(): string;
  getEnvironmentVariables(scope: EnvironmentScope): string;
  listEntries(scope?: EnvironmentScope): readonly SettingsEnvironmentEntryView[];
  applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  importEnvironmentText(scope: EnvironmentScope, envText: string): Promise<void>;
  getReviewKeys(scope: EnvironmentScope, envText: string): readonly string[];
}
