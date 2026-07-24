/** @jest-environment jsdom */

import { installObsidianDomHelpers } from '../../../setupObsidianUi';

installObsidianDomHelpers(window);

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownRenderer } from 'obsidian';

import { InlineEditSurfaceSession } from '@/app/ui/inlineEditSurface/InlineEditSurfaceSession';
import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

const writeText = jest.fn(async () => undefined);
const onReject = jest.fn();

jest.mock('@pivi/pivi-react/mount', () => ({
  mountInlineEditSurfaceChrome: jest.fn(() => ({
    update: jest.fn(),
    dispose: jest.fn(async () => undefined),
  })),
}));

jest.mock('obsidian', () => ({
  Component: class Component {
    children = new Set<object>();
    load(): void {}
    unload(): void {}
    register(): void {}
    registerDomEvent(): void {}
    addChild(child: { load?: () => void }): void {
      this.children.add(child);
      child.load?.();
    }
    removeChild(child: { unload?: () => void }): void {
      this.children.delete(child);
      child.unload?.();
    }
  },
  MarkdownRenderer: {
    render: jest.fn(async () => undefined),
  },
  Platform: { isMacOS: true },
}));

function createSnapshot(editor: EditorView): EditorSelectionSnapshot {
  return {
    from: editor.state.doc.line(1).from,
    to: editor.state.doc.line(1).to,
    text: editor.state.sliceDoc(editor.state.doc.line(1).from, editor.state.doc.line(1).to),
    rect: { top: 0, bottom: 10, left: 0, right: 10 },
    editorView: editor,
  };
}

function createSession(): InlineEditSurfaceSession {
  return new InlineEditSurfaceSession(
    {
      plugin: {
        app: {
          workspace: { getActiveFile: () => null },
          vault: {
            getFiles: () => [],
            getAllFolders: () => [],
          },
          metadataCache: {
            getFileCache: () => null,
          },
        },
        settings: { obsidianTools: { externalReadDirectories: [] } },
        getUiFacades: () => ({
          getSettingsSnapshot: () => ({ model: 'model-a', thinkingLevel: 'medium' }),
          chatUIConfig: {
            getReasoningOptions: () => [{ value: 'medium', label: 'Medium' }],
            isAdaptiveReasoningModel: () => false,
            getDefaultReasoningValue: () => 'medium',
          },
        }),
      } as never,
      i18n: { t: (key: string) => key } as never,
      platform: { renderIcon: jest.fn(), attachTooltip: jest.fn() } as never,
      composerDefaults: {
        model: 'model-a',
        thinkingLevel: 'medium',
        modelOptions: [{ value: 'model-a', label: 'Model A' }],
        thinkingOptions: [{ value: 'medium', label: 'Medium' }],
        adaptiveReasoning: false,
        defaultReasoningValue: 'medium',
      },
      getWorkspace: async () => ({
        mcpServerManager: {
          getServers: () => [],
          getContextSavingServers: () => [],
        },
        mcpToolProvider: { listTools: () => [] },
        skillProvider: { listSkills: () => [] },
        slashCommandCatalog: {
          getDropdownConfig: () => ({}),
          listDropdownEntries: async () => [],
        },
      }) as never,
    },
    { onReject },
  );
}

describe('InlineEditSurfaceSession DOM', () => {
  let editor: EditorView;
  let session: InlineEditSurfaceSession;

  beforeEach(() => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async () => undefined);
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    });
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    editor = new EditorView({
      state: EditorState.create({ doc: 'selected line\nnext line' }),
      parent,
    });

    session = createSession();
  });

  afterEach(() => {
    session.destroy();
    editor.destroy();
    editor.dom.remove();
    jest.useRealTimers();
  });

  it('mounts the expected inline edit surface structure', () => {
    session.show(createSnapshot(editor));

    const root = editor.dom.querySelector('.pivi-inline-edit-surface');
    expect(root).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-gutter .pivi-inline-edit-surface-close')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-input-host .pivi-inline-edit-surface-input')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-progress.pivi-response-meta'))
      .toHaveAttribute('role', 'timer');
    expect(root?.querySelector('.pivi-inline-edit-surface-tail .pivi-inline-edit-surface-chrome')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-tail .pivi-inline-edit-surface-send')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-at')).toBeNull();
    expect(root?.querySelector('article.pivi-inline-edit-surface-reply.pivi-message.pivi-message-assistant'))
      .not.toBeNull();
    expect(root?.querySelector(
      '.pivi-inline-edit-surface-reply > .pivi-message-content > '
      + '.pivi-inline-edit-surface-reply-content.pivi-text-block > .pivi-streaming-markdown',
    )).not.toBeNull();
    expect(root?.querySelectorAll('.pivi-inline-edit-surface-reply-actions button')).toHaveLength(1);
  });

  it('mounts fixed mention and slash selectors in a shared token-owning portal', async () => {
    session.show(createSnapshot(editor));
    await Promise.resolve();
    await Promise.resolve();

    const portal = document.body.querySelector(
      '.pivi-inline-selector-portal.pivi-inline-composer-selector-portal',
    );
    const input = editor.dom.querySelector<HTMLElement>('.pivi-inline-edit-surface-input');
    expect(portal).not.toBeNull();

    session.setPrompt('@');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    expect(portal?.querySelector('.pivi-mention-dropdown-fixed')).not.toBeNull();

    session.setPrompt('/');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    expect(portal?.querySelector('.pivi-slash-dropdown-fixed')).not.toBeNull();

    session.destroy();
    expect(document.body.querySelector('.pivi-inline-selector-portal')).toBeNull();
  });

  it('copies the raw Markdown reply from the transparent output action', async () => {
    session.show(createSnapshot(editor));
    session.setReplyText('## Heading\n\n**Markdown**');

    const reply = editor.dom.querySelector('.pivi-inline-edit-surface-reply');
    const copyButton = reply?.querySelector<HTMLButtonElement>('.pivi-inline-edit-surface-copy');
    expect(reply).toHaveClass('pivi-inline-edit-surface-reply--visible');
    expect(copyButton).not.toBeNull();
    copyButton?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('## Heading\n\n**Markdown**');
    expect(copyButton).toHaveClass('copied');
  });

  it('times exactly the interval spent waiting for the first visible streamed output', () => {
    jest.useFakeTimers();
    session.show(createSnapshot(editor));
    const root = editor.dom.querySelector('.pivi-inline-edit-surface');
    const progress = root?.querySelector('.pivi-inline-edit-surface-progress');

    expect(progress).not.toHaveClass('pivi-inline-edit-surface-progress--visible');
    session.setStreaming(true);
    expect(root).toHaveClass('pivi-inline-edit-surface--waiting');
    expect(progress).toHaveClass('pivi-inline-edit-surface-progress--visible');
    expect(progress).toHaveTextContent('* 0.0s');

    jest.advanceTimersByTime(2_200);
    expect(progress).toHaveTextContent('* 2.2s');

    session.setReplyText('   ');
    expect(root).toHaveClass('pivi-inline-edit-surface--waiting');

    session.setReplyText('First streamed text');
    expect(root).not.toHaveClass('pivi-inline-edit-surface--waiting');
    expect(progress).toHaveClass('pivi-inline-edit-surface-progress--visible');

    jest.advanceTimersByTime(2_000);
    expect(progress).toHaveTextContent('* 2.2s');

    session.setStreaming(false);
    expect(root).not.toHaveClass('pivi-inline-edit-surface--waiting');
    expect(progress).toHaveClass('pivi-inline-edit-surface-progress--visible');
    expect(progress).toHaveTextContent('* 2.2s');

    session.setStreaming(true);
    expect(progress).toHaveTextContent('* 0.0s');
    expect(root).toHaveClass('pivi-inline-edit-surface--waiting');
  });

  it('schedules and clears the waiting timer in the editor owner realm', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument!;
    const ownerWindow = iframe.contentWindow!;
    installObsidianDomHelpers(ownerWindow);
    const ownerSetInterval = jest.spyOn(ownerWindow, 'setInterval');
    const ownerClearInterval = jest.spyOn(ownerWindow, 'clearInterval');
    const defaultSetInterval = jest.spyOn(window, 'setInterval');
    const parent = ownerDocument.createElement('div');
    ownerDocument.body.appendChild(parent);
    const popupEditor = new EditorView({
      state: EditorState.create({ doc: 'popup selection' }),
      parent,
    });
    const popupSession = createSession();

    try {
      popupSession.show(createSnapshot(popupEditor));
      ownerSetInterval.mockClear();
      ownerClearInterval.mockClear();
      defaultSetInterval.mockClear();

      popupSession.setStreaming(true);
      expect(ownerSetInterval).toHaveBeenCalledWith(expect.any(Function), 100);
      expect(defaultSetInterval).not.toHaveBeenCalled();

      popupSession.setReplyText('First streamed text');
      expect(ownerClearInterval).toHaveBeenCalledTimes(1);

      popupSession.setStreaming(false);
      popupSession.setStreaming(true);
      popupSession.destroy();
      expect(ownerClearInterval).toHaveBeenCalledTimes(2);
    } finally {
      popupSession.destroy();
      popupEditor.destroy();
      iframe.remove();
      ownerSetInterval.mockRestore();
      ownerClearInterval.mockRestore();
      defaultSetInterval.mockRestore();
    }
  });

  it('updates a plain live tail immediately and performs full Markdown rendering only at terminal state', async () => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, target) => {
      target.textContent = markdown;
    });
    session.show(createSnapshot(editor));
    await Promise.resolve();
    await Promise.resolve();
    jest.mocked(MarkdownRenderer.render).mockClear();
    session.setStreaming(true);

    session.setReplyText('Settled paragraph.\n\n**live');
    await Promise.resolve();
    await Promise.resolve();

    const reply = editor.dom.querySelector('.pivi-inline-edit-surface-reply-content');
    expect(reply?.querySelector('.pivi-streaming-markdown-sealed')).toHaveTextContent('Settled paragraph.');
    expect(reply?.querySelector('.pivi-streaming-markdown-tail')).toHaveTextContent('**live');
    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);

    session.setReplyText('Settled paragraph.\n\n**live tail**');
    expect(reply?.querySelector('.pivi-streaming-markdown-tail')).toHaveTextContent('**live tail**');
    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);

    session.setStreaming(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(MarkdownRenderer.render).toHaveBeenLastCalledWith(
      expect.anything(),
      'Settled paragraph.\n\n**live tail**',
      expect.any(HTMLElement),
      expect.any(String),
      expect.anything(),
    );
    expect(reply?.querySelector('.pivi-streaming-markdown-tail')).toBeEmptyDOMElement();
  });

  it('keeps ordered-list lines intact when the newline arrives after the item text', async () => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, target) => {
      target.textContent = markdown;
    });
    session.show(createSnapshot(editor));
    await Promise.resolve();
    await Promise.resolve();
    jest.mocked(MarkdownRenderer.render).mockClear();
    session.setStreaming(true);

    session.setReplyText('Introduction.\n\n1.');
    await Promise.resolve();
    await Promise.resolve();
    session.setReplyText('Introduction.\n\n1. First item');
    session.setReplyText('Introduction.\n\n1. First item  \n');
    session.setReplyText('Introduction.\n\n1. First item  \n   - Detail');
    await Promise.resolve();
    await Promise.resolve();

    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
    expect(editor.dom.querySelector('.pivi-streaming-markdown-tail')?.textContent)
      .toBe('1. First item  \n   - Detail');
  });

  it('forwards typed input to the mention selector without a separate @ button', async () => {
    const handleInputChange = jest.spyOn(MentionDropdownController.prototype, 'handleInputChange');
    session.show(createSnapshot(editor));
    await Promise.resolve();

    const input = editor.dom.querySelector<HTMLElement>('.pivi-inline-edit-surface-input');
    input?.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(handleInputChange).toHaveBeenCalled();
  });

  it('keeps the surface mounted when the user points back into the editor', () => {
    session.show(createSnapshot(editor));
    const root = editor.dom.querySelector<HTMLElement>('.pivi-inline-edit-surface');
    const input = root?.querySelector<HTMLElement>('.pivi-inline-edit-surface-input');

    input?.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(onReject).not.toHaveBeenCalled();

    editor.contentDOM.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(onReject).not.toHaveBeenCalled();
  });
});
