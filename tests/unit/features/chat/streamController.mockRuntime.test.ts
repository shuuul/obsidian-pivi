import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import { TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { StreamController } from '@/ui/chat/controllers/StreamController';
import { ChatState } from '@/ui/chat/state/ChatState';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';
import { createMockPiUiFacades } from '../../../helpers/mockPiviPlugin';

class FakeElement {
  children: FakeElement[] = [];
  cls = '';
  isConnected = true;
  ownerDocument = { defaultView: globalThis as unknown as Window };
  parentElement: FakeElement | null = null;
  scrollHeight = 0;
  scrollTop = 0;
  text = '';

  get childElementCount(): number {
    return this.children.length;
  }

  get lastElementChild(): FakeElement | null {
    return this.children[this.children.length - 1] ?? null;
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
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }

  contains(child: FakeElement): boolean {
    if (child === this) {
      return true;
    }
    return this.children.some((candidate) => candidate.contains(child));
  }

  appendChild(child: FakeElement): FakeElement;
  appendChild(options?: { cls?: string; text?: string }): FakeElement;
  appendChild(input?: FakeElement | { cls?: string; text?: string }): FakeElement {
    const child = input instanceof FakeElement ? input : new FakeElement();
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((candidate) => candidate !== child);
    }
    child.parentElement = this;
    if (!(input instanceof FakeElement)) {
      child.cls = input?.cls ?? '';
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
    getUiFacades: () => createMockPiUiFacades({
      getSettingsSnapshot: (settings) => ({ ...settings }),
    }),
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

  const subagentManager = {
    subagentsSpawnedThisStream: 0,
    handleTaskToolUse: jest.fn(() => ({ action: 'buffered' })),
    hasPendingTask: jest.fn(() => false),
    renderPendingTask: jest.fn(() => null),
    getSyncSubagent: jest.fn(() => undefined),
    isPendingAsyncTask: jest.fn(() => false),
    hasAsyncTask: jest.fn(() => false),
    addAsyncToolCall: jest.fn(),
    updateAsyncToolResult: jest.fn(),
    appendSubagentText: jest.fn(() => null),
    isLinkedAgentOutputTool: jest.fn(() => false),
    handleAgentOutputToolResult: jest.fn(() => undefined),
    handleAsyncSubagentResult: jest.fn(() => undefined),
    refreshAsyncSubagent: jest.fn(),
    resetStreamingState: jest.fn(),
  };

  const controller = new StreamController({
    plugin,
    state,
    renderer: renderer as never,
    subagentManager: subagentManager as never,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => null,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => runtime,
  });

  return { controller, state, runtime, modelKey, renderer, subagentManager };
}

describe('StreamController with mock PiChatService', () => {
  beforeAll(() => {
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

  it('shows compacting with the compact thinking indicator before compact boundary', async () => {
    jest.useFakeTimers();
    try {
      const { controller, state } = createStreamControllerFixture();
      const contentEl = new FakeElement();
      state.currentContentEl = contentEl as unknown as HTMLElement;
      state.responseStartTime = performance.now();
      const msg: ChatMessage = {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 0,
      };

      await controller.handleStreamChunk({ type: 'text', content: 'Finished answer.' }, msg);
      await controller.handleStreamChunk({ type: 'context_compacting' }, msg);
      jest.advanceTimersByTime(400);

      expect(state.thinkingEl).not.toBeNull();
      expect((state.thinkingEl as unknown as FakeElement).cls).toBe('pivi-thinking pivi-thinking--compact');
      expect((state.thinkingEl as unknown as FakeElement).children[0].text).toBe('Compacting...');

      await controller.handleStreamChunk({ type: 'context_compacted' }, msg);

      expect(state.thinkingEl).toBeNull();
      expect(msg.contentBlocks).toEqual([
        { type: 'text', content: 'Finished answer.' },
        { type: 'context_compacted' },
      ]);
      expect(contentEl.children.some((child) => child.cls === 'pivi-compact-boundary')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores duplicate compacted chunks for the same assistant message', async () => {
    const { controller, state } = createStreamControllerFixture();
    const contentEl = new FakeElement();
    state.currentContentEl = contentEl as unknown as HTMLElement;
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.handleStreamChunk({ type: 'context_compacted' }, msg);
    await controller.handleStreamChunk({ type: 'context_compacted' }, msg);

    expect(msg.contentBlocks).toEqual([{ type: 'context_compacted' }]);
    expect(contentEl.children.filter((child) => child.cls === 'pivi-compact-boundary')).toHaveLength(1);
  });

  it('keeps each live subagent dock at the task position where it was created', async () => {
    const { controller, state, subagentManager } = createStreamControllerFixture();
    const contentEl = new FakeElement();
    state.currentContentEl = contentEl as unknown as HTMLElement;
    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    await controller.handleStreamChunk({
      type: 'tool_use',
      id: 'task-1',
      name: TOOL_TASK,
      input: { prompt: 'first task' },
    }, msg);
    const firstDock = contentEl.children.find((child) => child.cls === 'pivi-subagent-dock');

    await controller.handleStreamChunk({ type: 'text', content: 'Between tasks.' }, msg);
    await controller.handleStreamChunk({
      type: 'tool_use',
      id: 'task-2',
      name: TOOL_TASK,
      input: { prompt: 'second task' },
    }, msg);

    const docks = contentEl.children.filter((child) => child.cls === 'pivi-subagent-dock');
    expect(docks).toHaveLength(2);
    expect(docks[0]).toBe(firstDock);
    expect(contentEl.children.indexOf(docks[0])).toBeLessThan(contentEl.children.indexOf(docks[1]));
    expect(subagentManager.handleTaskToolUse).toHaveBeenNthCalledWith(
      1,
      'task-1',
      { prompt: 'first task' },
      docks[0],
      TOOL_TASK,
    );
    expect(subagentManager.handleTaskToolUse).toHaveBeenNthCalledWith(
      2,
      'task-2',
      { prompt: 'second task' },
      docks[1],
      TOOL_TASK,
    );
    expect(msg.contentBlocks).toEqual([
      { type: 'subagent', subagentId: 'task-1' },
      { type: 'text', content: 'Between tasks.' },
      { type: 'subagent', subagentId: 'task-2' },
    ]);
    controller.resetStreamingState();
  });

  it('ignores background subagent chunks when the owning assistant message is unknown', async () => {
    const { controller, state, subagentManager } = createStreamControllerFixture();
    state.messages = [{
      id: 'latest',
      role: 'assistant',
      content: '',
      timestamp: 1,
    }];

    await controller.handleBackgroundSubagentChunk({
      type: 'subagent_text',
      subagentId: 'old-spawn',
      content: 'old output',
    });

    expect(subagentManager.appendSubagentText).not.toHaveBeenCalled();
    expect(state.messages[0].contentBlocks).toBeUndefined();
  });

  it('does not create a current-turn dock when rendering pending background subagent chunks', async () => {
    const { controller, state, subagentManager } = createStreamControllerFixture();
    const currentContentEl = new FakeElement();
    state.currentContentEl = currentContentEl as unknown as HTMLElement;
    state.messages = [{
      id: 'owner',
      role: 'assistant',
      content: '',
      timestamp: 1,
      contentBlocks: [{ type: 'subagent', subagentId: 'old-spawn', mode: 'async' }],
    }];
    subagentManager.hasPendingTask.mockReturnValue(true);

    await controller.handleBackgroundSubagentChunk({
      type: 'subagent_text',
      subagentId: 'old-spawn',
      content: 'old output',
    });

    expect(subagentManager.renderPendingTask).toHaveBeenCalledWith('old-spawn');
    expect(currentContentEl.children).toEqual([]);
  });
});
