import type { ChatMessage } from '@pivi/core';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/core/settingsDefaults';
import { StreamController } from '@/ui/chat/controllers/StreamController';
import { ChatState } from '@/ui/chat/state/ChatState';
import { ensurePiAgentBootstrapped } from '../../../setupPiAgent';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';

class FakeElement {
  children: FakeElement[] = [];
  isConnected = true;
  ownerDocument = { defaultView: globalThis as unknown as Window };
  scrollHeight = 0;
  scrollTop = 0;
  text = '';

  get childElementCount(): number {
    return this.children.length;
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  setText(text: string): void {
    this.text = text;
  }

  remove(): void {
    this.isConnected = false;
  }

  appendChild(child: FakeElement): FakeElement;
  appendChild(options?: { cls?: string; text?: string }): FakeElement;
  appendChild(input?: FakeElement | { cls?: string; text?: string }): FakeElement {
    const child = input instanceof FakeElement ? input : new FakeElement();
    if (!(input instanceof FakeElement)) {
      child.text = input?.text ?? '';
    }
    this.children.push(child);
    return child;
  }
}

function createStreamControllerFixture() {
  const state = new ChatState();
  const runtime = createFakePiChatService();
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
    renderContent: jest.fn(async (el: FakeElement) => {
      if (el.childElementCount === 0) {
        el.createDiv({ text: 'rendered' });
      }
    }),
    scrollToBottom: jest.fn(),
  };

  const controller = new StreamController({
    plugin,
    state,
    renderer: renderer as never,
    subagentManager: {
      subagentsSpawnedThisStream: 0,
      hasPendingTask: jest.fn(() => false),
      getSyncSubagent: jest.fn(() => undefined),
      isPendingAsyncTask: jest.fn(() => false),
      isLinkedAgentOutputTool: jest.fn(() => false),
      handleAgentOutputToolResult: jest.fn(() => undefined),
      handleAsyncSubagentResult: jest.fn(() => undefined),
      refreshAsyncSubagent: jest.fn(),
      resetStreamingState: jest.fn(),
    } as never,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => null,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => runtime,
  });

  return { controller, state, runtime, modelKey, renderer };
}

describe('StreamController with mock PiChatService', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
    if (!globalThis.HTMLParagraphElement) {
      class TestHTMLParagraphElement {}
      Object.defineProperty(globalThis, 'HTMLParagraphElement', {
        configurable: true,
        value: TestHTMLParagraphElement,
      });
    }
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

  it('keeps message model order for tool_use -> tool_result -> text stream', async () => {
    const { controller, state } = createStreamControllerFixture();
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.handleStreamChunk({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'note.md' },
    }, msg);
    await controller.handleStreamChunk({
      type: 'tool_result',
      id: 'tool-1',
      content: 'ok',
    }, msg);

    state.currentContentEl = new FakeElement() as unknown as HTMLElement;
    await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);
    await controller.handleStreamChunk({ type: 'text', content: ' world' }, msg);
    await controller.finalizeCurrentTextBlock(msg);

    expect(msg.toolCalls).toEqual([expect.objectContaining({
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'note.md' },
      result: 'ok',
      status: 'completed',
    })]);
    expect(msg.contentBlocks).toEqual([
      { type: 'tool_use', toolId: 'tool-1' },
      { type: 'text', content: 'Hello world' },
    ]);
    expect(msg.content).toBe('Hello world');
  });
});
