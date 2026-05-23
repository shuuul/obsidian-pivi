import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { PI_PROVIDER_ICON } from '../../../shared/icons';
import { getPiProviderSettings } from '../settings';

export const PROVIDER_MODELS_MAP: Record<string, { label: string, value: string, description: string }[]> = {
  'anthropic': [
    { value: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', description: 'Powerful coding model' },
    { value: 'anthropic/claude-3-5-haiku', label: 'Claude 3.5 Haiku', description: 'Fast coding model' },
    { value: 'anthropic/claude-3-opus', label: 'Claude 3 Opus', description: 'Deep reasoning model' },
  ],
  'openai': [
    { value: 'openai/gpt-4o', label: 'GPT-4o', description: 'Multimodal flagship model' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast, lightweight model' },
    { value: 'openai/o1', label: 'o1', description: 'Deep reasoning model' },
    { value: 'openai/o3-mini', label: 'o3-mini', description: 'Fast reasoning model' },
  ],
  'gemini': [
    { value: 'gemini/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google flagship reasoning model' },
    { value: 'gemini/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Google fast lightweight model' },
  ],
  'deepseek': [
    { value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Highly competitive deep thinking model' },
    { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Extremely fast coding model' },
  ],
  'opencode-go': [
    { value: 'opencode-go/deepseek-v4-pro', label: 'DeepSeek V4 Pro (OpenCode)', description: 'OpenCode specialized reasoning' },
    { value: 'opencode-go/deepseek-v4-flash', label: 'DeepSeek V4 Flash (OpenCode)', description: 'OpenCode fast coding' },
    { value: 'opencode-go/glm-5.1', label: 'GLM 5.1 (OpenCode)', description: 'GLM coding model' },
    { value: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6 (OpenCode)', description: 'Kimi coding model' },
    { value: 'opencode-go/qwen3.6-plus', label: 'Qwen 3.6 Plus (OpenCode)', description: 'Qwen coding model' },
  ],
  'cursor': [
    { value: 'cursor/sonnet-latest', label: 'Claude 3.5 Sonnet (Cursor)', description: 'Cursor custom sonnet' },
    { value: 'cursor/composer-2.5', label: 'Composer 2.5', description: 'Cursor composer custom model' },
    { value: 'cursor/haiku-latest', label: 'Claude 3.5 Haiku (Cursor)', description: 'Cursor fast haiku' },
    { value: 'cursor/grok-latest', label: 'Grok Latest (Cursor)', description: 'Cursor grok model' },
  ],
  'groq': [
    { value: 'groq/llama-3.3-70b', label: 'Llama 3.3 70B', description: 'Fast open source model' },
  ],
  'openrouter': [
    { value: 'openrouter/auto', label: 'OpenRouter Auto', description: 'Fuzzy routed model' },
  ]
};



const DEFAULT_CONTEXT_WINDOW = 200_000;

const PI_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const piChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const piSettings = getPiProviderSettings(settings);
    const visible = piSettings.visibleModels;

    const options: ProviderUIOption[] = [];

    for (const modelVal of visible) {
      if (modelVal === 'pi-default') {
        options.push({ value: 'pi:pi-default', label: 'Pi Coding Agent', description: 'ACP runtime' });
        continue;
      }

      // Try to find in our PROVIDER_MODELS_MAP
      let label = modelVal;
      let description = 'Pi-supported model';

      const parts = modelVal.split('/');
      const prov = parts[0];
      const map = PROVIDER_MODELS_MAP[prov];
      if (map) {
        const found = map.find(m => m.value === modelVal);
        if (found) {
          label = found.label;
          description = found.description;
        }
      }

      options.push({
        value: `pi:${modelVal}`,
        label,
        description,
      });
    }

    if (options.length === 0) {
      options.push({ value: 'pi:pi-default', label: 'Pi Coding Agent', description: 'ACP runtime' });
    }

    return options;
  },

  ownsModel(model: string): boolean {
    return model.startsWith('pi:');
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return false;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    return 'none';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === 'pi:pi-default';
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.model = model;
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    // No-op for Pi
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    return model;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return PI_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return (settings.permissionMode as string | undefined) ?? 'yolo';
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
  },

  getProviderIcon() {
    return PI_PROVIDER_ICON;
  },
};
