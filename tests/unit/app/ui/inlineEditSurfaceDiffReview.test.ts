/** @jest-environment jsdom */

import { installObsidianDomHelpers } from '../../../setupObsidianUi';

installObsidianDomHelpers(window);

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type Editor, Platform } from 'obsidian';

import { InlineEditSurfaceSession } from '@/app/ui/inlineEditSurface/InlineEditSurfaceSession';
import {
  hasInlineEditDiffReviewDecoration,
  hasInlineEditDiffReviewReplaceDecoration,
} from '@/app/ui/inlineEditSurface/inlineEditDiffReviewField';
import { applyInlineEditAcceptance } from '@/app/ui/inlineEditHelpers';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

const renderIcon = jest.fn();

jest.mock('@pivi/pivi-react/mount', () => ({
  mountInlineEditSurfaceChrome: jest.fn(() => ({
    update: jest.fn(),
    dispose: jest.fn(async () => undefined),
  })),
}));

jest.mock('obsidian', () => ({
  Component: class Component {
    loaded = false;
    children = new Set<object>();

    load(): void {
      this.loaded = true;
    }

    unload(): void {
      this.loaded = false;
    }

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

jest.mock('@/app/ui/inlineEditHelpers', () => ({
  applyInlineEditAcceptance: jest.fn(),
}));

function createMockEditor(): Editor {
  return {
    offsetToPos: jest.fn((offset: number) => ({ line: offset, ch: 0 })),
    replaceRange: jest.fn(),
  } as unknown as Editor;
}

function createSnapshot(editor: EditorView, mockEditor: Editor): EditorSelectionSnapshot {
  const line = editor.state.doc.line(1);
  return {
    from: line.from,
    to: line.to,
    text: editor.state.sliceDoc(line.from, line.to),
    rect: { top: 0, bottom: 10, left: 0, right: 10 },
    editorView: editor,
    editor: mockEditor,
  };
}

function createSession(options: {
  onAccept?: () => void;
  onDiffReject?: () => void;
} = {}): InlineEditSurfaceSession {
  return new InlineEditSurfaceSession(
    {
      plugin: {
        app: {
          workspace: {
            getActiveFile: () => null,
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
      platform: { renderIcon, attachTooltip: jest.fn() } as never,
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
    options,
  );
}

describe('InlineEditSurfaceSession diff review', () => {
  let editor: EditorView;
  let mockEditor: Editor;
  let session: InlineEditSurfaceSession;

  beforeEach(() => {
    Platform.isMacOS = true;
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    editor = new EditorView({
      state: EditorState.create({ doc: 'selected line\nnext line' }),
      parent,
    });
    mockEditor = createMockEditor();
    session = createSession();
    session.show(createSnapshot(editor, mockEditor));
  });

  afterEach(() => {
    session.destroy();
    editor.destroy();
    editor.dom.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
  });


  it('enters diff review with replace decoration for replacement edits', () => {
    renderIcon.mockClear();
    session.showDiffReview('selected line', 'replacement line', 'replacement');

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(true);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(true);
    expect(editor.dom.querySelector('.pivi-inline-edit-diff-review')).not.toBeNull();
    expect(editor.dom.querySelector('.pivi-inline-edit-diff-review-deletion')).toHaveClass('markdown-rendered');
    expect(editor.dom.querySelector('.pivi-inline-edit-diff-review-insertion')).toHaveClass('markdown-rendered');
    expect(renderIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'circle-check');
    expect(renderIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'circle-x');
  });

  it('enters diff review without replace decoration for insertion edits', () => {
    session.showDiffReview('', 'inserted line', 'insertion');

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(true);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(false);
    expect(editor.dom.querySelector('.pivi-inline-edit-diff-review-deletion')).toBeNull();
    expect(editor.dom.querySelector('.pivi-inline-edit-diff-review-insertion')).not.toBeNull();
  });

  it('keeps the frozen first-output duration in diff review', () => {
    jest.useFakeTimers();
    session.setStreaming(true);
    jest.advanceTimersByTime(1_200);

    session.showDiffReview('selected line', 'replacement line', 'replacement');

    const progress = editor.dom.querySelector(
      '.pivi-inline-edit-diff-review-actions > .pivi-inline-edit-surface-progress',
    );
    expect(progress).toHaveClass('pivi-inline-edit-surface-progress--visible');
    expect(progress).toHaveTextContent('* 1.2s');
    jest.advanceTimersByTime(1_000);
    expect(progress).toHaveTextContent('* 1.2s');
  });

  it('clears diff review decorations after destroy', () => {
    session.showDiffReview('selected line', 'replacement line', 'replacement');
    session.destroy();

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(false);
  });

  it('accept applies the edit at the mapped selection range and dismisses', () => {
    const onAccept = jest.fn();
    session = createSession({ onAccept });
    const snapshot = createSnapshot(editor, mockEditor);
    session.show(snapshot);
    session.showDiffReview('selected line', 'replacement line', 'replacement');
    const focusSpy = jest.spyOn(editor, 'focus');
    const scrollSnapshotSpy = jest.spyOn(editor, 'scrollSnapshot');

    editor.dispatch({
      changes: { from: 0, insert: 'prefix ' },
    });

    editor.dom.querySelector<HTMLButtonElement>('.pivi-inline-edit-diff-review-accept')?.click();

    expect(applyInlineEditAcceptance).toHaveBeenCalledWith(
      mockEditor,
      snapshot.from + 'prefix '.length,
      snapshot.to + 'prefix '.length,
      'replacement line',
    );
    expect(onAccept).toHaveBeenCalled();
    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
    expect(scrollSnapshotSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('shows Ctrl+Enter as the accept shortcut on Windows/Linux', () => {
    Platform.isMacOS = false;
    session.showDiffReview('selected line', 'replacement line', 'replacement');

    const shortcut = editor.dom.querySelector(
      '.pivi-inline-edit-diff-review-accept .pivi-inline-edit-diff-review-shortcut',
    );
    expect(shortcut).toHaveTextContent('Ctrl+Enter');
  });

  it.each([
    ['Command+Enter on macOS', { metaKey: true }],
    ['Ctrl+Enter on Windows/Linux', { ctrlKey: true }],
  ])('accepts the diff with %s', (_shortcut, modifier) => {
    const onAccept = jest.fn();
    session = createSession({ onAccept });
    session.show(createSnapshot(editor, mockEditor));
    session.showDiffReview('selected line', 'replacement line', 'replacement');

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ...modifier,
      bubbles: true,
      cancelable: true,
    });
    editor.dom.ownerDocument.defaultView?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(applyInlineEditAcceptance).toHaveBeenCalledWith(
      mockEditor,
      0,
      'selected line'.length,
      'replacement line',
    );
    expect(onAccept).toHaveBeenCalled();
    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
  });

  it('accept inserts at the mapped selection end for insertion edits', () => {
    const onAccept = jest.fn();
    session = createSession({ onAccept });
    const snapshot = createSnapshot(editor, mockEditor);
    session.show(snapshot);
    session.showDiffReview('', 'inserted line', 'insertion');

    editor.dispatch({
      changes: { from: 0, insert: 'prefix ' },
    });

    editor.dom.querySelector<HTMLButtonElement>('.pivi-inline-edit-diff-review-accept')?.click();

    const mappedInsertPos = snapshot.to + 'prefix '.length;
    expect(applyInlineEditAcceptance).toHaveBeenCalledWith(
      mockEditor,
      mappedInsertPos,
      mappedInsertPos,
      'inserted line',
    );
    expect(onAccept).toHaveBeenCalled();
  });

  it('refuses accept and surfaces an error when the target text was deleted', () => {
    const snapshot = createSnapshot(editor, mockEditor);
    session.show(snapshot);
    session.showDiffReview('selected line', 'replacement line', 'replacement');

    editor.dispatch({
      changes: { from: snapshot.from, to: snapshot.to, insert: '' },
    });

    editor.dom.querySelector<HTMLButtonElement>('.pivi-inline-edit-diff-review-accept')?.click();

    expect(applyInlineEditAcceptance).not.toHaveBeenCalled();
    const errorEl = editor.dom.querySelector('.pivi-inline-edit-diff-review-error');
    expect(errorEl?.textContent).toBe('The selected text changed. Reject and try again.');
    expect(errorEl?.classList.contains('pivi-inline-edit-diff-review-error--visible')).toBe(true);
  });

  it('reject dismisses without applying edits', () => {
    const onDiffReject = jest.fn();
    session = createSession({ onDiffReject });
    session.show(createSnapshot(editor, mockEditor));
    session.showDiffReview('selected line', 'replacement line', 'replacement');
    const focusSpy = jest.spyOn(editor, 'focus');
    const scrollSnapshotSpy = jest.spyOn(editor, 'scrollSnapshot');

    editor.dom.querySelector<HTMLButtonElement>('.pivi-inline-edit-diff-review-reject')?.click();

    expect(applyInlineEditAcceptance).not.toHaveBeenCalled();
    expect(onDiffReject).toHaveBeenCalled();
    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
    expect(scrollSnapshotSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('rejects the diff with Escape', () => {
    const onDiffReject = jest.fn();
    session = createSession({ onDiffReject });
    session.show(createSnapshot(editor, mockEditor));
    session.showDiffReview('selected line', 'replacement line', 'replacement');

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    editor.dom.ownerDocument.defaultView?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(applyInlineEditAcceptance).not.toHaveBeenCalled();
    expect(onDiffReject).toHaveBeenCalled();
    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
  });
});
