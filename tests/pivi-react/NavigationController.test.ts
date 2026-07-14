import type { App } from 'obsidian';

import { NavigationController } from '@/ui/chat/controllers/NavigationController';
import { RichChatInput } from '@/ui/chat/ui/RichChatInput';

describe('NavigationController', () => {
  afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
  });

  it('switches between input and message navigation and scrolls with mapped keys', () => {
    const messagesEl = document.body.createDiv();
    messagesEl.scrollTop = 100;
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
    const requestAnimationFrame = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(1);
    const cancelAnimationFrame = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const controller = new NavigationController({
      getMessagesEl: () => messagesEl,
      getInputEl: () => richInput,
      getSettings: () => ({
        scrollUpKey: 'k',
        scrollDownKey: 'j',
        focusInputKey: 'i',
      }),
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
      key: 'k',
    }));
    expect(messagesEl.scrollTop).toBe(92);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'k' }));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    messagesEl.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'j',
    }));
    expect(messagesEl.scrollTop).toBe(100);

    messagesEl.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'i',
    }));
    expect(document.activeElement).toBe(richInput.el);

    controller.dispose();
  });
});
