import { DEFAULT_OBSIUS_SETTINGS } from '../../../../src/app/settings/defaultSettings';
import type { ChatMessage } from '../../../../src/core/types';
import { StreamController } from '../../../../src/features/chat/controllers/StreamController';
import { ChatState } from '../../../../src/features/chat/state/ChatState';
import { bootstrapPiAgent } from '../../../../src/pi/bootstrap';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

describe('StreamController with mock ChatRuntime', () => {
  beforeAll(() => {
    bootstrapPiAgent();
  });
  it('fills usage.model from settings when runtime is bound', async () => {
    const state = new ChatState();
    const runtime = createFakeChatRuntime();
    const modelKey = 'anthropic/claude-sonnet-4-20250514';
    const plugin = {
      settings: {
        ...DEFAULT_OBSIUS_SETTINGS,
        model: modelKey,
        piSettings: {
          ...DEFAULT_OBSIUS_SETTINGS.piSettings,
          visibleModels: [modelKey],
        },
        deferMathRenderingDuringStreaming: false,
      },
    } as never;

    const messagesEl = {
      ownerDocument: { defaultView: globalThis as Window },
    } as HTMLElement;

    const controller = new StreamController({
      plugin,
      state,
      renderer: {
        renderContent: jest.fn(async () => {}),
        addTextCopyButton: jest.fn(),
        scrollToBottom: jest.fn(),
      } as never,
      subagentManager: {
        subagentsSpawnedThisStream: 0,
        resetStreamingState: jest.fn(),
      } as never,
      getMessagesEl: () => messagesEl,
      getFileContextManager: () => null,
      updateQueueIndicator: jest.fn(),
      getAgentService: () => runtime,
    });

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.handleStreamChunk({
      type: 'usage',
      usage: {
        inputTokens: 10,
        contextWindow: 200_000,
        contextTokens: 15,
        percentage: 0,
      },
      sessionId: runtime.getSessionId(),
    }, msg);

    expect(state.usage).toMatchObject({
      inputTokens: 10,
      model: modelKey,
    });
  });
});
