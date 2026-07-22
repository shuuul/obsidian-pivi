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
    load(): void {}
    unload(): void {}
    register(): void {}
    registerDomEvent(): void {}
  },
  MarkdownRenderer: {
    render: jest.fn(async () => undefined),
  },
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

describe('InlineEditSurfaceSession DOM', () => {
  let editor: EditorView;
  let session: InlineEditSurfaceSession;

  beforeEach(() => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async () => undefined);
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

    session = new InlineEditSurfaceSession(
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
  });

  afterEach(() => {
    session.destroy();
    editor.destroy();
    editor.dom.remove();
  });

  it('mounts the expected inline edit surface structure', () => {
    session.show(createSnapshot(editor));

    const root = editor.dom.querySelector('.pivi-inline-edit-surface');
    expect(root).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-gutter .pivi-inline-edit-surface-close')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-input-host .pivi-inline-edit-surface-input')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-tail .pivi-inline-edit-surface-chrome')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-tail .pivi-inline-edit-surface-send')).not.toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-at')).toBeNull();
    expect(root?.querySelector('.pivi-inline-edit-surface-reply.pivi-message-assistant')).not.toBeNull();
    expect(root?.querySelector(
      '.pivi-inline-edit-surface-reply > .pivi-message-content > '
      + '.pivi-inline-edit-surface-reply-content.pivi-text-block.pivi-markdown-rendered',
    )).not.toBeNull();
    expect(root?.querySelectorAll('.pivi-inline-edit-surface-reply-actions button')).toHaveLength(1);
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

  it('animates only while waiting for the first visible streamed output', () => {
    session.show(createSnapshot(editor));
    const root = editor.dom.querySelector('.pivi-inline-edit-surface');

    session.setStreaming(true);
    expect(root).toHaveClass('pivi-inline-edit-surface--waiting');

    session.setReplyText('   ');
    expect(root).toHaveClass('pivi-inline-edit-surface--waiting');

    session.setReplyText('First streamed text');
    expect(root).not.toHaveClass('pivi-inline-edit-surface--waiting');

    session.setStreaming(false);
    expect(root).not.toHaveClass('pivi-inline-edit-surface--waiting');
  });

  it('keeps a newer streamed Markdown render when an older render finishes late', async () => {
    const pending: Array<() => void> = [];
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, target) => {
      target.textContent = markdown;
      await new Promise<void>((resolve) => pending.push(resolve));
    });
    session.show(createSnapshot(editor));

    session.setReplyText('Older chunk');
    session.setReplyText('Newest chunk');
    expect(pending).toHaveLength(2);

    pending[1]?.();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(editor.dom.querySelector('.pivi-inline-edit-surface-reply-content'))
      .toHaveTextContent('Newest chunk');

    pending[0]?.();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(editor.dom.querySelector('.pivi-inline-edit-surface-reply-content'))
      .toHaveTextContent('Newest chunk');
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
