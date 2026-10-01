import type {
  ChatModelsPort,
  ChatSettingsSnapshot,
} from '@pivi/agent/runtime/chatPorts';

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  getSettings: () => ChatSettingsSnapshot;
  getUIConfig: () => ChatModelsPort;
}
