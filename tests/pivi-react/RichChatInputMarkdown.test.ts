import type { App } from 'obsidian';
import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';

import { wireTabInputEvents } from '@/ui/chat/tabs/tabInputWiring';
import type { TabData } from '@/ui/chat/tabs/types';
import { RichChatInput } from '@/ui/chat/ui/RichChatInput';

describe('RichChatInput Markdown behavior', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('continues an ordered list and emits an input event', () => {
    const input = new RichChatInput(document.body.createDiv(), {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [],
          getFolders: () => [],
          getByPath: () => null,
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(),
      }),
    });
    const onInput = jest.fn();
    input.addEventListener('input', onInput);
    input.value = '1. first';

    expect(input.continueOrderedMarkdownList()).toBe(true);
    expect(input.value).toBe('1. first\n2. ');
    expect(input.selectionStart).toBe(input.value.length);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('continues a list before Enter-to-send while ordinary Enter still sends', () => {
    const contentEl = document.body.createDiv();
    const messagesEl = contentEl.createDiv();
    const input = new RichChatInput(contentEl, {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [],
          getFolders: () => [],
          getByPath: () => null,
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(),
      }),
    });
    const sendMessage = jest.fn(async () => undefined);
    const tab = {
      controllers: { inputController: { sendMessage } },
      dom: { contentEl, eventCleanups: [], messagesEl, richInput: input },
      state: { autoScrollEnabled: true, isStreaming: false },
      ui: {
        composerActions: null,
        fileContextManager: null,
        slashCommandDropdown: null,
      },
    } as unknown as TabData;
    const settings = {
      getSettingsSnapshot: () => ({
        enableAutoScroll: true,
        requireCommandOrControlEnterToSend: false,
      }),
    } as unknown as ChatSettingsPort;
    wireTabInputEvents(tab, settings);

    input.value = '1. first';
    input.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    expect(input.value).toBe('1. first\n2. ');
    expect(sendMessage).not.toHaveBeenCalled();

    input.value = 'plain text';
    input.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
