import type { App } from 'obsidian';

import { NavigationController } from '@/ui/chat/controllers/NavigationController';
import { RichChatInput } from '@/ui/chat/input/RichChatInput';

describe('NavigationController', () => {
  afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
  });

  it('moves focus from input to the messages panel on Escape', () => {
    const messagesEl = document.body.createDiv();
    const richInput = new RichChatInput(document.body.createDiv(), {
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
    const controller = new NavigationController({
      getMessagesEl: () => messagesEl,
      getInputEl: () => richInput,
      isStreaming: () => false,
    });

    controller.initialize();
    richInput.focus();
    richInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));

    expect(document.activeElement).toBe(messagesEl);
    expect(messagesEl).toHaveAttribute('tabindex', '0');

    messagesEl.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'w',
    }));
    expect(document.activeElement).toBe(messagesEl);

    controller.dispose();
  });
});
