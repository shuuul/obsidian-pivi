import { createInlineContextToken } from '@pivi/agent/context/inlineContext';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'node:util';
import type { App } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { RichChatInput } from '@/ui/chat/input/RichChatInput';
import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
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

  it('dismisses the slash dropdown outside a rich composer without treating its adapter as a DOM node', async () => {
    const container = document.body.createDiv();
    const input = new RichChatInput(container, {
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
    jest.spyOn(input, 'getTextOffsetClientRect').mockReturnValue(null);
    const dropdown = new SlashCommandDropdown(
      container,
      input,
      { onSelect: jest.fn() },
      { getSkills: () => [{ name: 'review' }] },
    );
    input.value = '/';

    dropdown.handleInputChange();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(dropdown.isVisible()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(dropdown.isVisible()).toBe(false);
    dropdown.destroy();
    input.destroy();
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

  function createClipboardEvent(
    type: 'copy' | 'cut' | 'paste',
    initialText = '',
  ): { event: ClipboardEvent; data: Record<string, string> } {
    const data: Record<string, string> = {};
    if (initialText) {
      data['text/plain'] = initialText;
    }
    const clipboardData = {
      getData: (format: string) => data[format] ?? '',
      setData: (format: string, value: string) => {
        data[format] = value;
      },
    };
    const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    return { event, data };
  }

  function selectEditorContents(editor: HTMLElement): void {
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    const selection = editor.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function placeCaretAtStart(editor: HTMLElement): void {
    editor.focus();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const selection = editor.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it('copies the canonical mention token instead of the visible badge label', () => {
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
    selectEditorContents(input.el);

    const { event, data } = createClipboardEvent('copy');
    input.el.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data['text/plain']).toBe('/generate-image a moonlit lake');
  });

  it('pastes a canonical token back into an inline badge', () => {
    const input = new RichChatInput(document.body.createDiv(), {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [{ path: 'notes/long-note.md', basename: 'long-note.md' }],
          getFolders: () => [],
          getByPath: (path: string) => (
            path === 'notes/long-note.md'
              ? { kind: 'file' as const, path, basename: 'long-note.md' }
              : null
          ),
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(),
      }),
    });
    placeCaretAtStart(input.el);
    const { event } = createClipboardEvent('paste', '@notes/long-note.md please summarize');
    input.handlePaste(event);

    const badge = input.el.querySelector<HTMLElement>('[data-mention-token="@notes/long-note.md"]');
    expect(badge).toHaveClass('pivi-context-badge--inline');
    expect(badge).toHaveTextContent('long-note.md');
    expect(input.value).toBe('@notes/long-note.md please summarize');
  });

  it('leaves pasted visible badge labels as plain text', () => {
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
    placeCaretAtStart(input.el);
    const { event } = createClipboardEvent('paste', 'generate image a moonlit lake');
    input.handlePaste(event);

    expect(input.el.querySelector('[data-mention-token]')).toBeNull();
    expect(input.value).toBe('generate image a moonlit lake');
  });

  it('cuts a mention badge as the canonical token and rebuilds the remaining text', () => {
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
    expect(badge).not.toBeNull();
    const range = input.el.ownerDocument.createRange();
    range.selectNode(badge!);
    const selection = input.el.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const { event, data } = createClipboardEvent('cut');
    input.el.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data['text/plain']).toBe('/generate-image');
    expect(input.el.querySelector('[data-mention-token]')).toBeNull();
    expect(input.value).toBe(' a moonlit lake');
  });
});
