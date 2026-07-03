import type { ChatUIConfig } from '@pivi/pivi-agent-core/foundation/chatUi';
import { Notice } from 'obsidian';

interface AppModelReadinessProvider {
  getStatus(
    model: string,
    settings: Record<string, unknown>,
  ): {
    kind: 'ready' | 'missing-credential' | 'oauth-expired' | 'disabled' | 'unavailable';
    label: string;
    description: string;
  };
  testModel(
    model: string,
    settings: Record<string, unknown>,
  ): Promise<{ ok: boolean; detail: string }>;
}

export function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ChatUIConfig;
  getModelReadinessProvider?: () => AppModelReadinessProvider | null;
}
