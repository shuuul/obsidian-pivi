import { createInlineContextToken } from '@pivi/agent/context/inlineContext';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'node:util';
import type { App } from 'obsidian';

import { appI18n } from '@/app/i18n';
import { RichChatInput } from '@/ui/chat/input/RichChatInput';
import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
import { extractComposerContent, setComposerCursor } from '@/ui/shared/mention/inlineMentionBadgeDom';
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
      app: {
        workspace,
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: { getAbstractFileByPath: () => null },
      } as unknown as App,
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
    await Promise.resolve();

    expect(workspace.openLinkText).toHaveBeenCalledWith('notes/readme.md', '', 'tab');
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

  it.each([
    ['@notes/first.md', '@notes/second.md', ' '],
    ['@notes/first.md', '/generate-image', ' '],
    ['/generate-image', '@notes/second.md', ' '],
    ['/generate-image', '/generate-image', ' '],
    ['@notes/first.md', '@notes/second.md', '\n'],
    ['@notes/first.md', '/generate-image', '\n'],
    ['/generate-image', '@notes/second.md', '\n'],
    ['/generate-image', '/generate-image', '\n'],
  ])('preserves %s when adding %s after %j', (first, second, separator) => {
    const input = new RichChatInput(document.body.createDiv(), {
      app: {} as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [{ path: 'notes/first.md', basename: 'first' }],
          getFolders: () => [],
          getByPath: (path: string) => ['notes/first.md', 'notes/second.md'].includes(path)
            ? { kind: 'file' as const, path, basename: path.split('/').at(-1)! } : null,
          resolveWikilink: () => null,
        },
        mcpServerNames: new Set(),
      }),
    });
    input.value = first;
    const line = separator === '\n' ? input.el.createDiv() : input.el;
    line.appendText(`${separator === ' ' ? ' ' : ''}${second[0]!}`);
    const range = document.createRange();
    range.selectNodeContents(line);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const before = input.value.slice(0, input.selectionStart - 1);
    input.insertReplacement(before, `${second} `, '');

    expect(Array.from(input.el.querySelectorAll<HTMLElement>('[data-mention-token]'))
      .map((badge) => badge.dataset.mentionToken)).toEqual([first, second]);
    expect(input.value).toBe(`${first}${separator}${second} `);
    input.destroy();
  });

  it.each<{ name: string; build: (editor: HTMLElement) => void; expected: string }>([
    { name: 'mixed text and div', expected: 'first\nsecond', build: (editor) => {
      editor.appendText('first');
      editor.createDiv({ text: 'second' });
    } },
    { name: 'div lines', expected: 'first\nsecond', build: (editor) => {
      editor.createDiv({ text: 'first' });
      editor.createDiv({ text: 'second' });
    } },
    { name: 'paragraph lines', expected: 'First\nSecond', build: (editor) => {
      editor.createEl('p', { text: 'First' });
      editor.createEl('p', { text: 'Second' });
    } },
    { name: 'empty line placeholder', expected: 'first\n\nsecond', build: (editor) => {
      editor.appendText('first');
      editor.createDiv().createEl('br');
      editor.createDiv({ text: 'second' });
    } },
    { name: 'nested spans', expected: 'first\nsecond', build: (editor) => {
      editor.createDiv().createSpan({ text: 'first' });
      editor.createDiv().createSpan({ text: 'second' });
    } },
    { name: 'explicit line break', expected: 'first\nsecond', build: (editor) => {
      editor.appendText('first');
      editor.createEl('br');
      editor.appendText('second');
    } },
  ])('round-trips text and every cursor boundary in $name', ({ build, expected }) => {
    const editor = document.body.createDiv();
    build(editor);
    expect(extractComposerContent(editor).text).toBe(expected);
    for (let offset = 0; offset <= expected.length; offset++) {
      setComposerCursor(editor, offset);
      expect(extractComposerContent(editor).cursorPos).toBe(offset);
    }
  });

  it('inserts a second slash selection before an existing badge without moving it or dropping the suffix', async () => {
    const container = document.body.createDiv();
    const input = new RichChatInput(container, {
      app: {} as App,
      getMentionContext: () => ({
        vault: { getFiles: () => [], getFolders: () => [], getByPath: () => null, resolveWikilink: () => null },
        mcpServerNames: new Set(),
        skillCommandNames: new Set(['review']),
      }),
    });
    jest.spyOn(input, 'getTextOffsetClientRect').mockReturnValue(null);
    const dropdown = new SlashCommandDropdown(container, input, { onSelect: jest.fn() }, {
      getSkills: () => [{ name: 'review' }],
    });
    input.value = '/review /generate-image keep suffix';
    // A native selection can end on the editor element, rather than a text node.
    const range = document.createRange();
    range.setStart(input.el, 1);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(input.selectionStart).toBe('/review'.length);
    dropdown.handleInputChange();
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(dropdown.isVisible()).toBe(true);
    dropdown.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.value).toBe('/review  /generate-image keep suffix');
    expect(input.el.querySelectorAll('[data-mention-token]')).toHaveLength(2);
    expect(input.selectionStart).toBe('/review '.length);
    dropdown.destroy();
    input.destroy();
  });

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

  it.each(['click', 'Enter', ' '])('opens a long file badge with %j and retains its full hover title', (action) => {
    const path = 'notes/A very long filename that must remain available on hover.md';
    const openLinkText = jest.fn();
    const input = new RichChatInput(document.body.createDiv(), {
      app: {
        workspace: { openLinkText },
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: { getAbstractFileByPath: () => null },
      } as unknown as App,
      getMentionContext: () => ({
        vault: {
          getFiles: () => [{ path, basename: 'A very long filename that must remain available on hover' }],
          getFolders: () => [], resolveWikilink: () => null,
          getByPath: (candidate) => candidate === path ? { kind: 'file', path, basename: 'A very long filename that must remain available on hover' } : null,
        },
        mcpServerNames: new Set(),
      }),
    });
    input.value = `@${path} `;
    const badge = input.el.querySelector<HTMLElement>('[data-mention-token]')!;
    expect(badge).toHaveAttribute('title', path);
    expect(badge).toHaveAttribute('role', 'button');
    if (action === 'click') badge.click();
    else badge.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true }));
    expect(openLinkText).toHaveBeenCalledWith(path, '', 'tab');
    expect(input.value).toBe(`@${path} `);
    input.destroy();
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
