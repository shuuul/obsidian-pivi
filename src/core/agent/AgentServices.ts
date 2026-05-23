import type ObsiusPlugin from '../../main';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import {
  type AgentAdaptor,
  type AgentSettingsReconciler,
  type ChatUIConfig,
  type ConversationHistoryService,
  type CreateChatRuntimeOptions,
  type InlineEditService,
  type InstructionRefineService,
  type RuntimeCapabilities,
  type SubagentLifecycleAdapter,
  type TaskResultInterpreter,
  type TitleGenerationService,
} from './types';

/**
 * Static facade for the in-process Pi agent (installed once from `main.ts`).
 *
 * Features depend on this port instead of importing `src/pi/` directly.
 */
export class AgentServices {
  private static adaptor: AgentAdaptor | null = null;

  static install(adaptor: AgentAdaptor): void {
    if (this.adaptor) {
      return;
    }
    this.adaptor = adaptor;
  }

  private static requireAdaptor(): AgentAdaptor {
    if (!this.adaptor) {
      throw new Error('Agent services are not installed.');
    }
    return this.adaptor;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    return this.requireAdaptor().createRuntime(options);
  }

  static createTitleGenerationService(plugin: ObsiusPlugin): TitleGenerationService {
    return this.requireAdaptor().createTitleGenerationService(plugin);
  }

  static createInstructionRefineService(plugin: ObsiusPlugin): InstructionRefineService {
    return this.requireAdaptor().createInstructionRefineService(plugin);
  }

  static createInlineEditService(plugin: ObsiusPlugin): InlineEditService {
    return this.requireAdaptor().createInlineEditService(plugin);
  }

  static getConversationHistoryService(): ConversationHistoryService {
    return this.requireAdaptor().historyService;
  }

  static getTaskResultInterpreter(): TaskResultInterpreter {
    return this.requireAdaptor().taskResultInterpreter;
  }

  static getSubagentLifecycleAdapter(): SubagentLifecycleAdapter | null {
    return this.requireAdaptor().subagentLifecycleAdapter ?? null;
  }

  static getCapabilities(): RuntimeCapabilities {
    return this.requireAdaptor().capabilities;
  }

  static getEnvironmentKeyPatterns(): RegExp[] {
    return this.requireAdaptor().environmentKeyPatterns ?? [];
  }

  static getChatUIConfig(): ChatUIConfig {
    return this.requireAdaptor().chatUIConfig;
  }

  static getSettingsReconciler(): AgentSettingsReconciler {
    return this.requireAdaptor().settingsReconciler;
  }

  static getDisplayName(): string {
    return this.requireAdaptor().displayName;
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return this.getChatUIConfig().getCustomModelIds(envVars);
  }
}
