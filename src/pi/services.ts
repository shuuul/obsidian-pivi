import type {
  AgentSettingsReconciler,
  ConversationHistoryService,
  TaskResultInterpreter,
  TaskTerminalStatus,
} from '../core/agent/types';
import { QueryBackedInlineEditService } from '../core/auxiliary/QueryBackedInlineEditService';
import { QueryBackedInstructionRefineService } from '../core/auxiliary/QueryBackedInstructionRefineService';
import { QueryBackedTitleGenerationService } from '../core/auxiliary/QueryBackedTitleGenerationService';
import type { Conversation } from '../core/types';
import type ObsiusPlugin from '../main';
import { PiAuxQueryRunner } from './runtime/PiAuxQueryRunner';

export class PiInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ObsiusPlugin) {
    super(new PiAuxQueryRunner(plugin));
  }
}

export class PiInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ObsiusPlugin) {
    super(new PiAuxQueryRunner(plugin));
  }
}

export class PiTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ObsiusPlugin) {
    super({
      createRunner: () => new PiAuxQueryRunner(plugin),
      resolveModel: () => plugin.settings.titleGenerationModel?.trim() || undefined,
    });
  }
}

export class PiTaskResultInterpreter implements TaskResultInterpreter {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  }

  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  }

  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: TaskTerminalStatus,
  ): TaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  }
}

export class PiConversationHistoryService implements ConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {}

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {}

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkAgentState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceAgentState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }
}

export const agentSettingsReconciler: AgentSettingsReconciler = {
  reconcileModelWithEnvironment(_settings, _conversations) {
    return { changed: false, invalidatedConversations: [] };
  },
  normalizeModelVariantSettings(_settings) {
    return false;
  },
};
