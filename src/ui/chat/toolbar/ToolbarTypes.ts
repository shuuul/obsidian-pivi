import type {
  ChatModelReadinessPort,
  ChatModelsPort,
  ChatSettingsSnapshot,
} from '@pivi/pivi-agent-core/runtime/chatPorts';

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  getSettings: () => ChatSettingsSnapshot;
  getUIConfig: () => ChatModelsPort;
  getModelReadinessProvider?: () => ChatModelReadinessPort | null;
}
