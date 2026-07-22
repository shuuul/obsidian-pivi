import { createInlineContextToken } from '@pivi/pivi-agent-core/context/inlineContext';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'node:util';
import type { App } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { RichChatInput } from '@/ui/chat/ui/RichChatInput';
import { MentionInput } from '@/ui/shared/mention/MentionInput';

describe('RichChatInput tool badges', () => {
  const originalTextEncoder = globalThis.TextEncoder;
  const originalTextDecoder = globalThis.TextDecoder;

  beforeAll(() => {
    if (!globalThis.TextEncoder) {
      Object.defineProperty(globalThis, 'TextEncoder', {
        configurable: true,
        value: NodeTextEncoder,
      });
    }
    if (!globalThis.TextDecoder) {
      Object.defineProperty(globalThis, 'TextDecoder', {
        configurable: true,
        value: NodeTextDecoder,
      });
    }
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      value: originalTextEncoder,
    });
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      value: originalTextDecoder,
    });
  });

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

  it('round-trips the selected-text variable as a removable settings badge', () => {
    const input = new MentionInput(document.body.createDiv(), {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [],
          getFolders: () => [],
          getByPath: () => null,
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(),
        parseWorkspaceCommandVariables: true,
      }),
    });

    input.value = 'Review {{selected_text}} carefully';

    const badge = input.el.querySelector<HTMLElement>(
      '[data-mention-token="{{selected_text}}"]',
    );
    expect(badge).toHaveClass(
      'pivi-context-badge-kind-selected-text-template',
      'pivi-context-badge--inline',
    );
    expect(badge).toHaveTextContent('Selected text');
    expect(input.value).toBe('Review {{selected_text}} carefully');

    badge?.querySelector<HTMLElement>('.pivi-context-badge-remove')?.click();
    expect(input.value).toBe('Review  carefully');
  });

  it('renders command-expanded selection like Add to chat and reveals its editor range', async () => {
    const editor = {
      lastLine: () => 3,
      getLine: () => 'selected text',
      setSelection: jest.fn(),
      scrollIntoView: jest.fn(),
      focus: jest.fn(),
    };
    const workspace = {
      openLinkText: jest.fn().mockResolvedValue(undefined),
      getActiveViewOfType: jest.fn().mockReturnValue({
        file: { path: 'notes/readme.md' },
        editor,
      }),
    };
    const context = {
      type: 'editor-selection' as const,
      notePath: 'notes/readme.md',
      noteName: 'readme.md',
      selection: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 8 } },
      includedLines: { from: 2, to: 2 },
      text: '<selection>selected</selection>',
    };
    const input = new RichChatInput(document.body.createDiv(), {
      app: { workspace } as unknown as App,
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

    input.value = createInlineContextToken(context);

    const badge = input.el.querySelector<HTMLElement>('.pivi-context-badge-kind-inline-context');
    expect(badge).toHaveClass('pivi-context-badge--inline', 'pivi-context-badge--clickable');
    expect(badge).toHaveAttribute('role', 'button');
    expect(badge).toHaveAttribute('tabindex', '0');

    badge?.click();
    await Promise.resolve();

    expect(workspace.openLinkText).toHaveBeenCalledWith('notes/readme.md', '');
    expect(editor.setSelection).toHaveBeenCalledWith(
      { line: 1, ch: 0 },
      { line: 1, ch: 8 },
    );
    expect(editor.scrollIntoView).toHaveBeenCalledWith({
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 8 },
    }, true);
    expect(editor.focus).toHaveBeenCalled();
  });
});
