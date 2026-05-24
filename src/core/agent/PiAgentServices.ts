import type ObsiusPlugin from '../../main';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import {
  type AgentSettingsReconciler,
  type ChatUIConfig,
  type ConversationHistoryService,
  type CreateChatRuntimeOptions,
  type InlineEditService,
  type InstructionRefineService,
  type PiAgentRegistration,
  type RuntimeCapabilities,
  type SubagentLifecycleAdapter,
  type TaskResultInterpreter,
  type TitleGenerationService,
} from './types';

/**
 * Static facade for the in-process Pi agent (bootstrapped once from `main.ts`).
 *
 * Features depend on this port instead of importing `src/pi/` directly.
 */
export class PiAgentServices {
  private static registration: PiAgentRegistration | null = null;

  static bootstrap(registration: PiAgentRegistration): void {
    if (this.registration) {
      return;
    }
    this.registration = registration;
  }

  private static requireRegistration(): PiAgentRegistration {
    if (!this.registration) {
      throw new Error('Pi agent services are not bootstrapped. Call bootstrapPiAgent() from main.ts.');
    }
    return this.registration;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    return this.requireRegistration().createRuntime(options);
  }

  static createTitleGenerationService(plugin: ObsiusPlugin): TitleGenerationService {
    return this.requireRegistration().createTitleGenerationService(plugin);
  }

  static createInstructionRefineService(plugin: ObsiusPlugin): InstructionRefineService {
    return this.requireRegistration().createInstructionRefineService(plugin);
  }

  static createInlineEditService(plugin: ObsiusPlugin): InlineEditService {
    return this.requireRegistration().createInlineEditService(plugin);
  }

  static getConversationHistoryService(): ConversationHistoryService {
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

  static getDisplayName(): string {
    return this.requireRegistration().displayName;
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return this.getChatUIConfig().getCustomModelIds(envVars);
  }
}
