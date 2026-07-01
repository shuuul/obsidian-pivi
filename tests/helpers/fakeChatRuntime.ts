import type { ChatRuntime } from '../../src/core/runtime/ChatRuntime';
import type {
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
} from '../../src/core/runtime/types';
import type { OpenSessionState, StreamChunk } from '../../src/core/types';

export interface FakeChatRuntimeSpies {
  syncOpenSessionState: jest.Mock<void, [OpenSessionState | null, string[]?]>;
  cleanup: jest.Mock<void, []>;
  onReadyStateChange: jest.Mock<() => void, [(ready: boolean) => void]>;
}

export type FakeChatRuntime = ChatRuntime & FakeChatRuntimeSpies;

export interface FakeChatRuntimeOptions {
  sessionId?: string | null;
  isReady?: boolean;
}

/** Minimal ChatRuntime double for features-layer unit tests. */
export function createFakeChatRuntime(
  options: FakeChatRuntimeOptions = {},
): FakeChatRuntime {
  const syncOpenSessionState = jest.fn();
  const cleanup = jest.fn();
  const readyListeners = new Set<(ready: boolean) => void>();
  const onReadyStateChange = jest.fn((listener: (ready: boolean) => void) => {
    readyListeners.add(listener);
    return () => readyListeners.delete(listener);
  });

  let sessionId = options.sessionId ?? 'fake-session';
  const isReady = options.isReady ?? true;

  const runtime: FakeChatRuntime = {
    syncOpenSessionState,
    cleanup,
    onReadyStateChange,
    prepareTurn: (request: ChatTurnRequest): PreparedChatTurn => ({
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: /^\/compact(\s|$)/i.test(request.text),
      mcpMentions: new Set(),
    }),
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
    rewind: jest.fn(async () => ({ canRewind: true, leafId: sessionId })),
    setApprovalCallback: jest.fn(),
    consumeTurnMetadata: (): ChatTurnMetadata => ({}),
    buildSessionUpdates: jest.fn(() => ({
      updates: { sessionId },
    })),
    resolveSessionIdForFork: () => sessionId,
  };

  return runtime;
}
