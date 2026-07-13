import type {
  ChatModelReadinessPort,
  ChatModelsPort,
  ChatSettingsSnapshot,
} from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Notice } from 'obsidian';

export function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  getSettings: () => ChatSettingsSnapshot;
  getUIConfig: () => ChatModelsPort;
  getModelReadinessProvider?: () => ChatModelReadinessPort | null;
}
