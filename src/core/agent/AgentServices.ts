import type PiviPlugin from '../../main';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import {
  type AgentRegistration,
  type AgentSettingsPersistence,
  type AgentSettingsReconciler,
  type ChatUIConfig,
  type CreateChatRuntimeOptions,
  type InlineEditService,
  type RuntimeCapabilities,
  type SessionHistoryService,
  type SubagentLifecycleAdapter,
  type TaskResultInterpreter,
  type TitleGenerationService,
} from './types';

/**
 * Static facade for the active in-process agent runtime (bootstrapped once from `main.ts`).
 *
 * Features depend on this port instead of importing an adaptor directly.
 */
export class AgentServices {
  private static registration: AgentRegistration | null = null;

  static bootstrap(registration: AgentRegistration): void {
    if (this.registration) {
      return;
    }
    this.registration = registration;
  }

  private static requireRegistration(): AgentRegistration {
    if (!this.registration) {
      throw new Error('Agent services are not bootstrapped. Call bootstrapPiAgent() from main.ts.');
    }
    return this.registration;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    return this.requireRegistration().createRuntime(options);
  }

  static createTitleGenerationService(plugin: PiviPlugin): TitleGenerationService {
    return this.requireRegistration().createTitleGenerationService(plugin);
  }


  static createInlineEditService(plugin: PiviPlugin): InlineEditService {
    return this.requireRegistration().createInlineEditService(plugin);
  }

  static getSessionHistoryService(): SessionHistoryService {
    return this.requireRegistration().historyService;
  }

  static getTaskResultInterpreter(): TaskResultInterpreter {
    return this.requireRegistration().taskResultInterpreter;
  }

  static getSubagentLifecycleAdapter(): SubagentLifecycleAdapter | null {
    return this.requireRegistration().subagentLifecycleAdapter ?? null;
  }

  static getCapabilities(): RuntimeCapabilities {
    return this.requireRegistration().capabilities;
  }

  static getEnvironmentKeyPatterns(): RegExp[] {
    return this.requireRegistration().environmentKeyPatterns ?? [];
  }

  static getChatUIConfig(): ChatUIConfig {
    return this.requireRegistration().chatUIConfig;
  }

  static getSettingsReconciler(): AgentSettingsReconciler {
    return this.requireRegistration().settingsReconciler;
  }

  static getSettingsPersistence(): AgentSettingsPersistence {
    return this.requireRegistration().settingsPersistence;
  }

  static getDisplayName(): string {
    return this.requireRegistration().displayName;
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return this.getChatUIConfig().getCustomModelIds(envVars);
  }
}
