import type { RuntimeCapabilities } from '../../src/core/agent/types';
import type { ChatRuntime } from '../../src/core/runtime/ChatRuntime';
import type {
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
} from '../../src/core/runtime/types';
import type { Conversation, StreamChunk } from '../../src/core/types';
import { PI_RUNTIME_CAPABILITIES } from '../../src/pi/capabilities';

export interface FakeChatRuntimeSpies {
  syncConversationState: jest.Mock<void, [Conversation | null, string[]?]>;
  cleanup: jest.Mock<void, []>;
  onReadyStateChange: jest.Mock<() => void, [(ready: boolean) => void]>;
}

export type FakeChatRuntime = ChatRuntime & FakeChatRuntimeSpies;

export interface FakeChatRuntimeOptions {
  capabilities?: RuntimeCapabilities;
  sessionId?: string | null;
  isReady?: boolean;
}

/** Minimal ChatRuntime double for features-layer unit tests. */
export function createFakeChatRuntime(
  options: FakeChatRuntimeOptions = {},
): FakeChatRuntime {
  const syncConversationState = jest.fn();
  const cleanup = jest.fn();
  const readyListeners = new Set<(ready: boolean) => void>();
  const onReadyStateChange = jest.fn((listener: (ready: boolean) => void) => {
    readyListeners.add(listener);
    return () => readyListeners.delete(listener);
  });

  const capabilities = options.capabilities ?? PI_RUNTIME_CAPABILITIES;
  let sessionId = options.sessionId ?? 'fake-session';
  const isReady = options.isReady ?? true;

  const runtime: FakeChatRuntime = {
    syncConversationState,
    cleanup,
    onReadyStateChange,
    getCapabilities: () => capabilities,
    prepareTurn: (request: ChatTurnRequest): PreparedChatTurn => ({
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: /^\/compact(\s|$)/i.test(request.text),
      mcpMentions: new Set(),
    }),
    setResumeCheckpoint: jest.fn(),
    reloadMcpServers: jest.fn(async () => {}),
    ensureReady: jest.fn(async () => isReady),
    query: async function* query(): AsyncGenerator<StreamChunk> {
      yield { type: 'text', content: 'ok' };
    },
    cancel: jest.fn(),
    resetSession: jest.fn(() => {
      sessionId = 'fake-session-reset';
    }),
    getSessionId: () => sessionId,
    consumeSessionInvalidation: () => false,
    isReady: () => isReady,
    getSupportedCommands: jest.fn(async () => []),
    rewind: jest.fn(async () => ({ canRewind: false })),
    setApprovalCallback: jest.fn(),
    setApprovalDismisser: jest.fn(),
    setAskUserQuestionCallback: jest.fn(),
    setExitPlanModeCallback: jest.fn(),
    setPermissionModeSyncCallback: jest.fn(),
    setSubagentHookState: jest.fn(),
    setAutoTurnCallback: jest.fn(),
    consumeTurnMetadata: (): ChatTurnMetadata => ({}),
    buildSessionUpdates: jest.fn(() => ({
      updates: { sessionId },
    })),
    resolveSessionIdForFork: () => sessionId,
  };

  return runtime;
}
