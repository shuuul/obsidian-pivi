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

    const ports = {
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

    await expect(submitInlineEditTurn(manager, ports, {
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
});
