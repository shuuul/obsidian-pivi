import type {
  AgentSettingsReconciler,
  ConversationHistoryService,
  TaskResultInterpreter,
  TaskTerminalStatus,
} from '../core/agent/types';
import { QueryBackedInlineEditService } from '../core/auxiliary/QueryBackedInlineEditService';
import { QueryBackedTitleGenerationService } from '../core/auxiliary/QueryBackedTitleGenerationService';
import type { LeafSummary } from '../core/session/types';
import type { Conversation } from '../core/types';
import type ObsiusPlugin from '../main';
import { PiAuxQueryRunner } from './runtime/PiAuxQueryRunner';
import { tryGetSessionStore } from './session/sessionStoreRegistry';

export class PiInlineEditService extends QueryBackedInlineEditService {
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
    conversation: Conversation,
    _vaultPath: string | null,
    leafId?: string | null,
  ): Promise<void> {
    const store = tryGetSessionStore();
    if (!store || !conversation.sessionFile) {
      return;
    }

    const ref = store.sessionRefFromConversation(conversation);
    if (!ref) {
      return;
    }

    const activeLeaf = leafId ?? conversation.leafId ?? ref.leafId;
    const opened = await store.open(ref.sessionFile, activeLeaf || undefined);
    conversation.messages = await store.getMessages(opened);
    conversation.sessionId = opened.sessionId;
    conversation.leafId = opened.leafId;
    conversation.sessionFile = opened.sessionFile;

    const uiContext = await store.readUiContext(opened);
    conversation.currentNote = uiContext.currentNote;
    conversation.externalContextPaths = uiContext.externalContextPaths;
    conversation.enabledMcpServers = uiContext.enabledMcpServers;
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    if (!conversation.sessionFile) {
      return;
    }
    const store = tryGetSessionStore();
    if (!store) {
      return;
    }
    await store.deleteSession(conversation.sessionFile);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkAgentState(
    _sourceSessionId: string,
    _resumeAt: string,
    sourceAgentState?: Record<string, unknown>,
  ): Record<string, unknown> {
    const sessionFile =
      sourceAgentState && typeof sourceAgentState.piSessionFile === 'string'
        ? sourceAgentState.piSessionFile
        : undefined;
    if (!sessionFile) {
      return {};
    }
    return { piSessionFile: sessionFile };
  }

  async forkSession(
    conversation: Conversation,
    atEntryId: string,
    _vaultPath: string | null,
  ): Promise<{ sessionFile: string; leafId: string; sessionId: string } | null> {
    const store = tryGetSessionStore();
    if (!store || !conversation.sessionFile) {
      return null;
    }
    const ref = store.sessionRefFromConversation(conversation);
    if (!ref) {
      return null;
    }
    const forked = await store.fork(ref, atEntryId);
    return {
      sessionFile: forked.sessionFile,
      leafId: forked.leafId,
      sessionId: forked.sessionId,
    };
  }

  async listLeaves(
    sessionFile: string,
    _vaultPath: string | null,
  ): Promise<LeafSummary[]> {
    const store = tryGetSessionStore();
    if (!store) {
      return [];
    }
    return store.listLeaves(sessionFile);
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
