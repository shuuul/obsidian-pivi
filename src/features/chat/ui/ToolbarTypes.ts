import { Notice } from 'obsidian';

import type {
  AppModelReadinessProvider,
  ChatUIConfig,
  RuntimeCapabilities,
} from '../../../core/agent/types';

export function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  permissionMode: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onThinkingLevelChange: (thinkingLevel: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ChatUIConfig;
  getCapabilities: () => RuntimeCapabilities;
  getModelReadinessProvider?: () => AppModelReadinessProvider | null;
}

