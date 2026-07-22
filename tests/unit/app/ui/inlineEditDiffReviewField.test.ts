/** @jest-environment jsdom */

import { installObsidianDomHelpers } from '../../../setupObsidianUi';

installObsidianDomHelpers(window);

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  getInlineEditDiffReviewAcceptRange,
  hasInlineEditDiffReviewDecoration,
  hasInlineEditDiffReviewReplaceDecoration,
  hideInlineEditDiffReviewDecoration,
  InlineEditDiffReviewWidget,
  showInlineEditDiffReviewDecoration,
} from '@/app/ui/inlineEditSurface/inlineEditDiffReviewField';
import { createInlineEditSurfaceRoot } from '@/app/ui/inlineEditSurface/inlineEditSurfaceField';
import type { InlineEditSurfaceSessionId } from '@/app/ui/inlineEditSurface/types';

const sessionA = 'session-a' as InlineEditSurfaceSessionId;
const sessionB = 'session-b' as InlineEditSurfaceSessionId;

function createTestEditor(doc = 'alpha\nbeta\ngamma'): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc }),
    parent,
  });
}

describe('inlineEditDiffReviewField', () => {
  let editor: EditorView;

  beforeEach(() => {
    editor = createTestEditor();
  });

  afterEach(() => {
    hideInlineEditDiffReviewDecoration(editor, sessionA);
    hideInlineEditDiffReviewDecoration(editor, sessionB);
    editor.destroy();
    editor.dom.remove();
  });

  it('shows replace decoration for replacement diff review', () => {
    const line = editor.state.doc.line(1);
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);

    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: line.from,
      to: line.to,
      kind: 'replacement',
      widget,
    });

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(true);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(true);
    expect(getInlineEditDiffReviewAcceptRange(editor, sessionA)).toEqual({
      from: line.from,
      to: line.to,
    });
  });

  it('omits replace decoration for insertion diff review', () => {
    const line = editor.state.doc.line(1);
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);

    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: line.from,
      to: line.to,
      kind: 'insertion',
      widget,
    });

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(true);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(false);
    expect(getInlineEditDiffReviewAcceptRange(editor, sessionA)).toEqual({
      from: line.to,
      to: line.to,
    });
  });

  it('maps accept range after document edits', () => {
    const line = editor.state.doc.line(1);
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);

    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: line.from,
      to: line.to,
      kind: 'replacement',
      widget,
    });

    editor.dispatch({
      changes: { from: 0, insert: 'prefix ' },
    });

    expect(getInlineEditDiffReviewAcceptRange(editor, sessionA)).toEqual({
      from: line.from + 'prefix '.length,
      to: line.to + 'prefix '.length,
    });
  });

  it('returns null when the replace decoration target is deleted', () => {
    const line = editor.state.doc.line(1);
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);

    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: line.from,
      to: line.to,
      kind: 'replacement',
      widget,
    });

    editor.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
    });

    expect(getInlineEditDiffReviewAcceptRange(editor, sessionA)).toBeNull();
  });

  it('clears diff review decorations on hide', () => {
    const line = editor.state.doc.line(1);
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);

    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: line.from,
      to: line.to,
      kind: 'replacement',
      widget,
    });

    hideInlineEditDiffReviewDecoration(editor, sessionA);

    expect(hasInlineEditDiffReviewDecoration(editor)).toBe(false);
    expect(hasInlineEditDiffReviewReplaceDecoration(editor)).toBe(false);
    expect(getInlineEditDiffReviewAcceptRange(editor, sessionA)).toBeNull();
  });
  it('keeps sibling diff sessions when one is hidden', () => {
    const firstLine = editor.state.doc.line(1);
    const secondLine = editor.state.doc.line(2);
    showInlineEditDiffReviewDecoration(editor, sessionA, {
      from: firstLine.from,
      to: firstLine.to,
      kind: 'replacement',
      widget: new InlineEditDiffReviewWidget(createInlineEditSurfaceRoot(document)),
    });
    showInlineEditDiffReviewDecoration(editor, sessionB, {
      from: secondLine.from,
      to: secondLine.to,
      kind: 'replacement',
      widget: new InlineEditDiffReviewWidget(createInlineEditSurfaceRoot(document)),
    });

    hideInlineEditDiffReviewDecoration(editor, sessionA);

    expect(hasInlineEditDiffReviewDecoration(editor, sessionA)).toBe(false);
    expect(hasInlineEditDiffReviewDecoration(editor, sessionB)).toBe(true);
    expect(getInlineEditDiffReviewAcceptRange(editor, sessionB)).toEqual({
      from: secondLine.from,
      to: secondLine.to,
    });
  });
  it('ignores editor events so widget controls stay interactive', () => {
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditDiffReviewWidget(root);
    expect(widget.ignoreEvent()).toBe(true);
  });
});
