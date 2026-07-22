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

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected asynchronous setup to complete');
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
            tab.state.streamGeneration += 1;
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
          sendMessage: jest.fn(async () => {
            tab.state.streamGeneration += 1;
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

  it('forwards assistant text from the live query before the turn promise resolves', async () => {
    let streaming = true;
    let resolveSend: () => void = () => undefined;
    let sendOptions: { onAssistantText?: (text: string) => void } | undefined;
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
          sendMessage: jest.fn((options: { onAssistantText?: (text: string) => void }) => {
            tab.state.streamGeneration += 1;
            sendOptions = options;
            return new Promise<void>((resolve) => {
              resolveSend = resolve;
            });
          }),
        },
      },
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    const onAssistantText = jest.fn();
    let resolved = false;
    const turnPromise = submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite\n\n<selected_text>\nhello\n</selected_text>',
      onAssistantText,
    }).then((result) => {
      resolved = true;
      return result;
    });
    await flushUntil(() => sendOptions !== undefined);

    assistantTextBlock.content = 'Hel';
    sendOptions?.onAssistantText?.('Hel');
    assistantTextBlock.content = 'Hello';
    sendOptions?.onAssistantText?.('Hello');
    assistantTextBlock.content = 'Hello world';
    sendOptions?.onAssistantText?.('Hello world');

    const resolvedBeforeSendCompleted = resolved;
    const streamedValues = onAssistantText.mock.calls.map(call => call[0]);

    streaming = false;
    resolveSend();
    await expect(turnPromise).resolves.toEqual({
      assistantText: 'Hello world',
      tabId: 'inline-edit-tab',
    });
    expect(resolvedBeforeSendCompleted).toBe(false);
    expect(streamedValues).toEqual(['Hel', 'Hello', 'Hello world']);
  });

  it('does not forward late assistant text after cancellation', async () => {
    let streaming = true;
    let registeredCancel: (() => void) | null = null;
    const cancelStreaming = jest.fn(() => {
      streaming = false;
    });
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
          sendMessage: jest.fn(async (options: { onAssistantText?: (text: string) => void }) => {
            tab.state.streamGeneration += 1;
            registeredCancel?.();
            options.onAssistantText?.('Partial');
          }),
          cancelStreaming,
        },
      },
    };

    const manager = {
      createTab: jest.fn(async () => tab),
    } as unknown as TabManager;

    const onAssistantText = jest.fn();

    await expect(submitInlineEditTurn(manager, createPorts(), {
      content: 'Rewrite',
      onAssistantText,
      registerCancel: (cancel) => {
        registeredCancel = cancel;
      },
    })).resolves.toBeNull();

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(onAssistantText).not.toHaveBeenCalled();
  });
});
