import type {
  AgentSettingsReconciler,
  ConversationHistoryService,
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
  InstructionRefineService,
  RefineProgressCallback,
  TaskResultInterpreter,
  TaskTerminalStatus,
  TitleGenerationCallback,
  TitleGenerationService,
} from '../core/agent/types';
import type { Conversation, InstructionRefineResult } from '../core/types';

export class PiInlineEditService implements InlineEditService {
  resetConversation(): void {}

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    return { success: true, editedText: request.mode === 'selection' ? request.selectedText : '' };
  }

  async continueConversation(message: string): Promise<InlineEditResult> {
    return { success: true, editedText: message };
  }

  cancel(): void {}
}

export class PiInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {}

  async refineInstruction(
    rawInstruction: string,
    _existingInstructions: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: true, refinedInstruction: rawInstruction };
  }

  async continueConversation(
    message: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: true, refinedInstruction: message };
  }

  cancel(): void {}
}

export class PiTitleGenerationService implements TitleGenerationService {
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const title = userMessage.trim().substring(0, 30) || 'New Chat';
    await callback(conversationId, { success: true, title });
  }

  cancel(): void {}
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

export const piSettingsReconciler: AgentSettingsReconciler = {
  reconcileModelWithEnvironment(_settings, _conversations) {
    return { changed: false, invalidatedConversations: [] };
  },
  normalizeModelVariantSettings(_settings) {
    return false;
  },
};
