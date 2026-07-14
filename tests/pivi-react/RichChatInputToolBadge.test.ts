import type { App } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { RichChatInput } from '@/ui/chat/ui/RichChatInput';

describe('RichChatInput tool badges', () => {
  afterEach(() => {
    appI18n.setLocale('en');
    document.body.replaceChildren();
  });

  it('keeps the image tool token as an inline badge and plain-text value', () => {
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

    input.value = '/generate-image a moonlit lake';

    const badge = input.el.querySelector<HTMLElement>('[data-mention-token="/generate-image"]');
    expect(badge).toHaveClass('pivi-context-badge-kind-tool', 'pivi-context-badge--inline');
    expect(badge).toHaveTextContent('generate image');
    expect(input.value).toBe('/generate-image a moonlit lake');
  });

  it('localizes the image tool tooltip without translating its identifier', () => {
    appI18n.setLocale('zh-CN');
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

    input.value = '/generate-image';

    expect(input.el.querySelector<HTMLElement>('[data-mention-token="/generate-image"]'))
      .toHaveAttribute('title', '工具：obsidian_generate_image');
  });
});
