export type PromptModuleKind = 'core' | 'workflow' | 'custom';

export interface PromptModuleOverride {
  readonly enabled?: boolean;
  readonly customBody?: string;
}

export interface CustomPromptModule {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly enabled: boolean;
}

export interface ShippedPromptModule {
  readonly id: string;
  readonly kind: 'core' | 'workflow';
  readonly title: string;
  readonly defaultBody: string;
  readonly defaultEnabled: boolean;
}

export interface ResolvedPromptModule {
  readonly id: string;
  readonly kind: PromptModuleKind;
  readonly title: string;
  readonly body: string;
  readonly enabled: boolean;
  readonly modified: boolean;
}

export interface ComposedPromptSections {
  readonly core: string;
  readonly workflow: string;
  readonly custom: string;
  readonly fullStatic: string;
}

export interface PromptModuleSettings {
  readonly promptModules: Record<string, PromptModuleOverride>;
  readonly customPromptModules: CustomPromptModule[];
}
