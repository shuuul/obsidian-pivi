/** @jest-environment jsdom */

import { installObsidianDomHelpers } from '../../../setupObsidianUi';

installObsidianDomHelpers(window);

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  createInlineEditSurfaceRoot,
  getInlineEditSurfaceAnchorPos,
  hideInlineEditSurfaceDecoration,
  InlineEditSurfaceWidget,
  resolveInlineEditAnchorPos,
  showInlineEditSurfaceDecoration,
} from '@/app/ui/inlineEditSurface/inlineEditSurfaceField';
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

describe('inlineEditSurfaceField', () => {
  let editor: EditorView;

  beforeEach(() => {
    editor = createTestEditor();
  });

  afterEach(() => {
    hideInlineEditSurfaceDecoration(editor, sessionA);
    hideInlineEditSurfaceDecoration(editor, sessionB);
    editor.destroy();
    editor.dom.remove();
  });

  it('anchors the widget at the first line of the selection', () => {
    const line = editor.state.doc.line(2);
    const anchorPos = resolveInlineEditAnchorPos(editor, line.from + 2);
    expect(anchorPos).toBe(line.from);
  });

  it('shows and hides the inline edit surface decoration', () => {
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditSurfaceWidget(root);
    const line = editor.state.doc.line(2);
    const anchorPos = resolveInlineEditAnchorPos(editor, line.from + 1);

    showInlineEditSurfaceDecoration(editor, sessionA, line.from, line.to, widget);
    expect(getInlineEditSurfaceAnchorPos(editor, sessionA)).toBe(anchorPos);

    hideInlineEditSurfaceDecoration(editor, sessionA);
    expect(getInlineEditSurfaceAnchorPos(editor, sessionA)).toBeNull();
  });

  it('renders the widget root inside the editor DOM when shown', () => {
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditSurfaceWidget(root);
    const anchorPos = resolveInlineEditAnchorPos(editor, editor.state.doc.line(1).from);

    showInlineEditSurfaceDecoration(editor, sessionA, anchorPos, anchorPos + 1, widget);

    expect(editor.dom.querySelector('[data-pivi-inline-edit-surface="true"]')).toBe(root);
  });

  it('keeps multiple sessions mounted and hides only the requested session', () => {
    const firstRoot = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const secondRoot = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const firstLine = editor.state.doc.line(1);
    const secondLine = editor.state.doc.line(2);

    showInlineEditSurfaceDecoration(
      editor,
      sessionA,
      firstLine.from,
      firstLine.to,
      new InlineEditSurfaceWidget(firstRoot),
    );
    showInlineEditSurfaceDecoration(
      editor,
      sessionB,
      secondLine.from,
      secondLine.to,
      new InlineEditSurfaceWidget(secondRoot),
    );

    expect(editor.dom.querySelectorAll('[data-pivi-inline-edit-surface="true"]')).toHaveLength(2);
    hideInlineEditSurfaceDecoration(editor, sessionA);
    expect(firstRoot.isConnected).toBe(false);
    expect(secondRoot.isConnected).toBe(true);
    expect(getInlineEditSurfaceAnchorPos(editor, sessionB)).toBe(secondLine.from);
  });
  it('ignores editor events so widget controls stay interactive', () => {
    const root = createInlineEditSurfaceRoot(editor.dom.ownerDocument);
    const widget = new InlineEditSurfaceWidget(root);
    expect(widget.ignoreEvent()).toBe(true);
  });
});
