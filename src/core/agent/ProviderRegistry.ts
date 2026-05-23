import type ObsiusPlugin from '../../main';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import {
  type CreateChatRuntimeOptions,
  DEFAULT_CHAT_PROVIDER_ID,
  type InlineEditService,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderChatUIConfig,
  type ProviderConversationHistoryService,
  type ProviderRegistration,
  type ProviderSettingsReconciler,
  type ProviderSubagentLifecycleAdapter,
  type ProviderTaskResultInterpreter,
  type TitleGenerationService,
} from './types';

/**
 * Single-provider facade for chat-facing Pi services.
 *
 * Bootstrap installs the Pi adaptor from `main.ts` via `install()`.
 * Shared bootstrap (defaults, storage) is composed through `src/core/bootstrap/`
 * and `src/pi/app/`.
 */
export class ProviderRegistry {
  private static registration: ProviderRegistration | null = null;

  static install(registration: ProviderRegistration): void {
    if (this.registration) {
      return;
    }
    this.registration = registration;
  }

  private static getProviderRegistration(): ProviderRegistration {
    if (!this.registration) {
      throw new Error(`Provider "${DEFAULT_CHAT_PROVIDER_ID}" is not installed.`);
    }
    return this.registration;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    return this.getProviderRegistration().createRuntime(options);
  }

  static createTitleGenerationService(plugin: ObsiusPlugin): TitleGenerationService {
    return this.getProviderRegistration().createTitleGenerationService(plugin);
  }

  static createInstructionRefineService(plugin: ObsiusPlugin): InstructionRefineService {
    return this.getProviderRegistration().createInstructionRefineService(plugin);
  }

  static createInlineEditService(plugin: ObsiusPlugin): InlineEditService {
    return this.getProviderRegistration().createInlineEditService(plugin);
  }

  static getConversationHistoryService(): ProviderConversationHistoryService {
    return this.getProviderRegistration().historyService;
  }

  static getTaskResultInterpreter(): ProviderTaskResultInterpreter {
    return this.getProviderRegistration().taskResultInterpreter;
  }

  static getSubagentLifecycleAdapter(): ProviderSubagentLifecycleAdapter | null {
    return this.getProviderRegistration().subagentLifecycleAdapter ?? null;
  }

  static getCapabilities(): ProviderCapabilities {
    return this.getProviderRegistration().capabilities;
  }

  static getEnvironmentKeyPatterns(): RegExp[] {
    return this.getProviderRegistration().environmentKeyPatterns ?? [];
  }

  static getChatUIConfig(): ProviderChatUIConfig {
    return this.getProviderRegistration().chatUIConfig;
  }

  static getSettingsReconciler(): ProviderSettingsReconciler {
    return this.getProviderRegistration().settingsReconciler;
  }

  static getRegisteredProviderIds(): readonly [typeof DEFAULT_CHAT_PROVIDER_ID] | [] {
    return this.registration ? [DEFAULT_CHAT_PROVIDER_ID] : [];
  }

  static getProviderDisplayName(): string {
    return this.getProviderRegistration().displayName;
  }

  static isEnabled(_settings: Record<string, unknown>): boolean {
    return this.getProviderRegistration().isEnabled(_settings);
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return this.getChatUIConfig().getCustomModelIds(envVars);
  }
}
