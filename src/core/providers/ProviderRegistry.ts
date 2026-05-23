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
  type ProviderId,
  type ProviderRegistration,
  type ProviderSettingsReconciler,
  type ProviderSubagentLifecycleAdapter,
  type ProviderTaskResultInterpreter,
  type TitleGenerationService,
} from './types';

/**
 * Single-provider facade for chat-facing Pi services.
 *
 * Bootstrap concerns (defaults, shared storage, workspace services) are composed
 * in `main.ts` through `src/core/bootstrap/` and `src/providers/pi/app/`.
 */
export class ProviderRegistry {
  private static registration: ProviderRegistration | null = null;

  static register(
    _providerId: ProviderId,
    registration: ProviderRegistration,
  ): void {
    this.registration = registration;
  }

  private static getProviderRegistration(): ProviderRegistration {
    if (!this.registration) {
      throw new Error(`Provider "${DEFAULT_CHAT_PROVIDER_ID}" is not registered.`);
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

  static getRegisteredProviderIds(): ProviderId[] {
    return this.registration ? [DEFAULT_CHAT_PROVIDER_ID] : [];
  }

  static getEnabledProviderIds(_settings?: Record<string, unknown>): ProviderId[] {
    if (!this.registration?.isEnabled(_settings ?? {})) {
      return [];
    }
    return [DEFAULT_CHAT_PROVIDER_ID];
  }

  static getProviderDisplayName(): string {
    return this.getProviderRegistration().displayName;
  }

  static isEnabled(_providerId: ProviderId, settings: Record<string, unknown>): boolean {
    return this.getProviderRegistration().isEnabled(settings);
  }

  static resolveProviderForModel(
    _model: string,
    _settings: Record<string, unknown> = {},
  ): ProviderId {
    return DEFAULT_CHAT_PROVIDER_ID;
  }

  static getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return this.getChatUIConfig().getCustomModelIds(envVars);
  }
}
