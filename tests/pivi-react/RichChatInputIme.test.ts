import type { App } from 'obsidian';

import { RichChatInput } from '@/ui/chat/ui/RichChatInput';

describe('RichChatInput IME composition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.replaceChildren();
  });

  it('does not rebuild mention badges until composition ends', () => {
    const parent = document.body.createDiv();
    const input = new RichChatInput(parent, {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [],
          getFolders: () => [],
          getByPath: () => null,
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(['vault']),
      }),
    });
    input.el.textContent = '/vault ';

    input.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.el.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.el.querySelector('[data-mention-token]')).toBeNull();
    expect(input.value).toBe('/vault ');

    input.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(input.el.querySelector('[data-mention-token]')).toBeNull();

    jest.runOnlyPendingTimers();

    expect(input.el.querySelector('[data-mention-token="/vault"]')).toHaveClass('pivi-context-badge--inline');
    expect(input.value).toBe('/vault ');
  });
});
