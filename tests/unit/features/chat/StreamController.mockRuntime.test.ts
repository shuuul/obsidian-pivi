import { DEFAULT_PIVI_SETTINGS } from '../../../../src/app/settings/defaultSettings';
import type { ChatMessage } from '../../../../src/pi/types';
import { StreamController } from '../../../../src/features/chat/controllers/StreamController';
import { ChatState } from '../../../../src/features/chat/state/ChatState';
import { ensurePiAgentBootstrapped } from '../../../setupPiAgent';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

function createStreamControllerFixture() {
  const state = new ChatState();
  const runtime = createFakeChatRuntime();
  const modelKey = 'opencode-go/deepseek-v4-flash';
  const plugin = {
    app: {},
    settings: {
      ...DEFAULT_PIVI_SETTINGS,
      model: modelKey,
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        visibleModels: [modelKey],
      },
      deferMathRenderingDuringStreaming: false,
    },
  } as never;

  const messagesEl = {
    ownerDocument: { defaultView: globalThis as unknown as Window },
    scrollHeight: 0,
    scrollTop: 0,
  } as HTMLElement;

  const renderer = {
    renderContent: jest.fn(async () => {}),
    addTextCopyButton: jest.fn(),
    scrollToBottom: jest.fn(),
  };

  const controller = new StreamController({
    plugin,
    state,
    renderer: renderer as never,
    subagentManager: {
      subagentsSpawnedThisStream: 0,
      resetStreamingState: jest.fn(),
    } as never,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => null,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => runtime,
  });

  return { controller, state, runtime, modelKey, renderer };
}

describe('StreamController with mock ChatRuntime', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });
  it('fills usage.model from settings when runtime is bound', async () => {
    const { controller, state, runtime, modelKey } = createStreamControllerFixture();

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

  it('does not create an empty thinking block for empty provider reasoning chunks', async () => {
    const { controller, state } = createStreamControllerFixture();
    const createDiv = jest.fn();
    state.currentContentEl = {
      createDiv,
      ownerDocument: { defaultView: globalThis as unknown as Window },
    } as unknown as HTMLElement;

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.handleStreamChunk({ type: 'thinking', content: '' }, msg);

    expect(createDiv).not.toHaveBeenCalled();
    expect(state.currentThinkingState).toBeNull();
    expect(msg.contentBlocks).toBeUndefined();
  });

  it('removes an existing thinking block if it finalizes empty', async () => {
    const { controller, state } = createStreamControllerFixture();
    const remove = jest.fn();
    state.currentThinkingState = {
      wrapperEl: { remove } as unknown as HTMLElement,
      contentEl: { ownerDocument: { defaultView: globalThis as unknown as Window } } as HTMLElement,
      labelEl: {} as HTMLElement,
      content: '  \n',
      startTime: Date.now(),
      timerInterval: null,
      isExpanded: false,
    };

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.finalizeCurrentThinkingBlock(msg);

    expect(remove).toHaveBeenCalled();
    expect(state.currentThinkingState).toBeNull();
    expect(msg.contentBlocks).toBeUndefined();
  });
});
