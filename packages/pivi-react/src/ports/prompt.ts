export type SettingsPromptModuleKind = 'core' | 'workflow' | 'custom';

export type SettingsPromptUsageSectionId = 'core' | 'workflow' | 'custom' | 'tools' | 'mcp';

export interface SettingsPromptModuleView {
  readonly id: string;
  readonly kind: SettingsPromptModuleKind;
  readonly title: string;
  readonly enabled: boolean;
  readonly modified: boolean;
  readonly body: string;
}

export interface SettingsPromptUsageSection {
  readonly id: SettingsPromptUsageSectionId;
  readonly estimatedTokens: number;
}

export interface SettingsPromptUsageSnapshot {
  readonly sections: readonly SettingsPromptUsageSection[];
  readonly totalEstimatedTokens: number;
}

export interface SettingsPromptCreateInput {
  readonly title?: string;
  readonly body?: string;
  readonly enabled?: boolean;
}

export interface SettingsPromptPort {
  getCatalogRevision(): number;
  listModules(): readonly SettingsPromptModuleView[];
  getUsage(): SettingsPromptUsageSnapshot;
  setWorkflowEnabled(id: string, enabled: boolean, catalogRevision: number): Promise<void>;
  saveCustomBody(id: string, customBody: string, catalogRevision: number): Promise<void>;
  restoreShipped(id: string, catalogRevision: number): Promise<void>;
  createCustomModule(input: SettingsPromptCreateInput | undefined, catalogRevision: number): Promise<SettingsPromptModuleView>;
  renameCustomModule(id: string, title: string, catalogRevision: number): Promise<void>;
  editCustomModule(id: string, body: string, catalogRevision: number): Promise<void>;
  reorderCustomModules(ids: readonly string[], catalogRevision: number): Promise<void>;
  setCustomModuleEnabled(id: string, enabled: boolean, catalogRevision: number): Promise<void>;
  deleteCustomModule(id: string, catalogRevision: number): Promise<void>;
}
