import type { PiChatService } from '@pivi/pi-runtime/PiChatService';
import type {
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@pivi/pi-runtime/types';
import type { StreamChunk } from '@pivi/core';

export interface FakePiChatServiceSpies {
  syncSession: jest.Mock<void, [{ sessionFile: string | null; leafId?: string | null } | null, string[]?]>;
  cleanup: jest.Mock<void, []>;
  onReadyStateChange: jest.Mock<() => void, [(ready: boolean) => void]>;
}

export type FakePiChatService = PiChatService & FakePiChatServiceSpies;

export interface FakePiChatServiceOptions {
  sessionId?: string | null;
  isReady?: boolean;
}

/** Minimal PiChatService double for features-layer unit tests. */
export function createFakePiChatService(
  options: FakePiChatServiceOptions = {},
): FakePiChatService {
  const syncSession = jest.fn();
  const cleanup = jest.fn();
  const readyListeners = new Set<(ready: boolean) => void>();
  const onReadyStateChange = jest.fn((listener: (ready: boolean) => void) => {
    readyListeners.add(listener);
    return () => readyListeners.delete(listener);
  });

  let sessionId = options.sessionId ?? 'fake-session';
  const isReady = options.isReady ?? true;

  const runtime: FakePiChatService = {
    syncSession,
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
    isReady: () => isReady,
    rewind: jest.fn(async () => ({ canRewind: true, leafId: sessionId })),
    setApprovalCallback: jest.fn(),
    consumeTurnMetadata: (): ChatTurnMetadata => ({}),
    getSessionStateUpdates: jest.fn(() => ({ sessionId })),
  };

  return runtime;
}
