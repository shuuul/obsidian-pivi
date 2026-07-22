import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';

import { submitInlineEditTurn } from '@/app/ui/imperativeChatInlineEdit';
import type { TabManager } from '@/ui/chat/tabs/TabManager';

function createMessagesElement(): HTMLElement {
  const element = { appendChild: jest.fn() } as unknown as HTMLElement;
  const ownerWindow = {
    performance: { now: () => Date.now() },
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
  } as unknown as Window;
  Object.defineProperty(element, 'ownerDocument', {
    value: { defaultView: ownerWindow },
    configurable: true,
  });
  return element;
}

function createPorts(): ChatPorts {
  return {
    settings: {
      getSettingsSnapshot: () => ({
        model: 'draft-model',
        thinkingLevel: 'medium',
      }),
      commitSettingsSnapshot: jest.fn(async () => undefined),
    },
    models: {
      applyModelDefaults: jest.fn(),
      applyReasoningSelection: jest.fn(),
    },
  } as unknown as ChatPorts;
}

describe('submitInlineEditTurn', () => {
  it('creates an archived tab, sends the turn, and returns assistant text', async () => {
    let streaming = true;
    const tab = {
      id: 'inline-edit-tab',
      lifecycleState: 'bound_active',
      state: {
        streamGeneration: 1,
        messages: [] as Array<Record<string, unknown>>,
        get isStreaming() {
          return streaming;
        },
      },
      dom: {
        messagesEl: createMessagesElement(),
      },
      controllers: {
        inputController: {
          sendMessage: jest.fn(async () => {
            tab.state.messages = [
              { id: 'u1', role: 'user', content: 'prompt', timestamp: 1 },
              {
                id: 'a1',
                role: 'assistant',
                content: '',
                contentBlocks: [{ type: 'text', content: 'Rewritten text' }],
                timestamp: 2,
              },
            ];
            streaming = false;
          }),
        },
      },
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    await expect(submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite\n\n<selected_text>\nhello\n</selected_text>',
      model: 'draft-model',
      thinkingLevel: 'medium',
      draftTitle: 'Rewrite',
    })).resolves.toEqual({
      assistantText: 'Rewritten text',
      tabId: 'inline-edit-tab',
    });

    expect(manager.createTab).toHaveBeenCalledWith(undefined, undefined, {
      activate: false,
      isArchived: true,
      draftModel: 'draft-model',
      draftTitle: 'Rewrite',
    });
  });

  it('registers a cancel callback that cancels the tab streaming', async () => {
    let streaming = true;
    let registeredCancel: (() => void) | null = null;
    const cancelStreaming = jest.fn(() => {
      streaming = false;
    });
    const tab = {
      id: 'inline-edit-tab',
      lifecycleState: 'bound_active',
      state: {
        streamGeneration: 1,
        messages: [] as Array<Record<string, unknown>>,
        get isStreaming() {
          return streaming;
        },
      },
      dom: {
        messagesEl: createMessagesElement(),
      },
      controllers: {
        inputController: {
          // The mocked ownerWindow setTimeout is synchronous, so the streaming poll
          // spins in microtasks; cancel must fire before the poll starts.
          sendMessage: jest.fn(async () => {
            registeredCancel?.();
          }),
          cancelStreaming,
        },
      },
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    await submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite',
      registerCancel: (cancel) => {
        registeredCancel = cancel;
      },
    });

    expect(registeredCancel).not.toBeNull();
    expect(cancelStreaming).toHaveBeenCalledTimes(1);
  });

  it('calls onAssistantText during streaming with monotonically accumulating text', async () => {
    let streaming = true;
    let pollTick = 0;
    const assistantTextBlock = { type: 'text' as const, content: '' };
    const assistantMessage = {
      id: 'a1',
      role: 'assistant' as const,
      content: '',
      contentBlocks: [assistantTextBlock],
      timestamp: 2,
    };
    const tab = {
      id: 'inline-edit-tab',
      lifecycleState: 'bound_active',
      state: {
        streamGeneration: 1,
        messages: [
          { id: 'u1', role: 'user' as const, content: 'prompt', timestamp: 1 },
          assistantMessage,
        ],
        get isStreaming() {
          return streaming;
        },
      },
      dom: {
        messagesEl: createMessagesElement(),
      },
      controllers: {
        inputController: {
          sendMessage: jest.fn(async () => undefined),
        },
      },
    };

    const messagesEl = tab.dom.messagesEl;
    const ownerWindow = messagesEl.ownerDocument.defaultView as Window & {
      setTimeout: (callback: () => void, delay?: number) => number;
    };
    const originalSetTimeout = ownerWindow.setTimeout.bind(ownerWindow);
    ownerWindow.setTimeout = (callback: () => void, delay?: number) => {
      if (delay === 50) {
        pollTick += 1;
        if (pollTick === 1) {
          assistantTextBlock.content = 'Hel';
        } else if (pollTick === 2) {
          assistantTextBlock.content = 'Hello';
        } else if (pollTick === 3) {
          assistantTextBlock.content = 'Hello world';
        } else {
          streaming = false;
        }
      }
      return originalSetTimeout(callback, delay);
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    const onAssistantText = jest.fn();

    await expect(submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite\n\n<selected_text>\nhello\n</selected_text>',
      onAssistantText,
    })).resolves.toEqual({
      assistantText: 'Hello world',
      tabId: 'inline-edit-tab',
    });

    expect(onAssistantText).toHaveBeenCalledTimes(3);
    expect(onAssistantText.mock.calls.map(call => call[0])).toEqual([
      'Hel',
      'Hello',
      'Hello world',
    ]);
    for (let index = 1; index < onAssistantText.mock.calls.length; index += 1) {
      const previous = onAssistantText.mock.calls[index - 1][0] as string;
      const current = onAssistantText.mock.calls[index][0] as string;
      expect(current.startsWith(previous)).toBe(true);
      expect(current.length).toBeGreaterThanOrEqual(previous.length);
    }
    expect(onAssistantText.mock.calls.at(-1)?.[0]).toBe('Hello world');
  });

  it('does not call onAssistantText when streaming is cancelled', async () => {
    let streaming = true;
    let pollTick = 0;
    const assistantMessage = {
      id: 'a1',
      role: 'assistant' as const,
      content: '',
      contentBlocks: [{ type: 'text' as const, content: 'Partial' }],
      timestamp: 2,
    };
    const tab = {
      id: 'inline-edit-tab',
      lifecycleState: 'bound_active' as string,
      state: {
        streamGeneration: 1,
        messages: [
          { id: 'u1', role: 'user' as const, content: 'prompt', timestamp: 1 },
          assistantMessage,
        ],
        get isStreaming() {
          return streaming;
        },
      },
      dom: {
        messagesEl: createMessagesElement(),
      },
      controllers: {
        inputController: {
          sendMessage: jest.fn(async () => undefined),
        },
      },
    };

    const messagesEl = tab.dom.messagesEl;
    const ownerWindow = messagesEl.ownerDocument.defaultView as Window & {
      setTimeout: (callback: () => void, delay?: number) => number;
    };
    const originalSetTimeout = ownerWindow.setTimeout.bind(ownerWindow);
    ownerWindow.setTimeout = (callback: () => void, delay?: number) => {
      if (delay === 50) {
        pollTick += 1;
        if (pollTick === 1) {
          tab.lifecycleState = 'closing';
        }
      }
      return originalSetTimeout(callback, delay);
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    const onAssistantText = jest.fn();

    await expect(submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite',
      onAssistantText,
    })).resolves.toBeNull();

    expect(onAssistantText).toHaveBeenCalledTimes(1);
    expect(onAssistantText).toHaveBeenCalledWith('Partial');
  });
});
