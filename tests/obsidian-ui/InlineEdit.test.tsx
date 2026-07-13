import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { act, fireEvent, render, screen } from '@testing-library/react';

import { createI18n } from '@pivi/obsidian-ui';
import { InlineEditView, createInlineEditController, hideInlineEditWidget, inlineEditWidgetField, mountInlineEdit, showInlineEditWidget, type MountedInlineEdit } from '@pivi/obsidian-ui';
import type { InlineEditPort } from '@pivi/obsidian-ui/ports';
import { I18nProvider } from '@pivi/obsidian-ui';
import type { InlineEditResult, InlineEditService } from '@pivi/pivi-agent-core/runtime/auxTypes';

function createService(results: InlineEditResult[]): InlineEditService {
  return {
    cancel: jest.fn(),
    resetSession: jest.fn(),
    editText: jest.fn(async () => results.shift() ?? { success: false, error: 'failed' }),
    continueSession: jest.fn(async () => results.shift() ?? { success: false, error: 'failed' }),
  };
}

function createController(results: InlineEditResult[]) {
  return createInlineEditController({} as InlineEditPort, {
    context: { mode: 'selection', selectedText: 'old text', startLine: 2 },
    notePath: 'note.md',
    service: createService(results),
  });
}

describe('InlineEditView', () => {
  it('generates a diff and accepts it', async () => {
    const controller = createController([{ success: true, editedText: 'new text' }]);
    const accept = jest.fn();
    render(<I18nProvider i18n={createI18n()}><InlineEditView controller={controller} onAccept={accept} onReject={jest.fn()} /></I18nProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rewrite' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(screen.getByText('new')).toBeInTheDocument();
    fireEvent.click(screen.getByText('✓'));
    expect(accept).toHaveBeenCalledWith('new text');
  });

  it('rejects a generated diff without applying it', async () => {
    const controller = createController([{ success: true, editedText: 'new text' }]);
    const reject = jest.fn();
    render(<I18nProvider i18n={createI18n()}><InlineEditView controller={controller} onAccept={jest.fn()} onReject={reject} /></I18nProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rewrite' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    fireEvent.click(screen.getByText('✕'));
    expect(reject).toHaveBeenCalledTimes(1);
    expect(controller.state.phase).toBe('cancelled');
  });

  it('continues a clarification and handles errors and cancellation', async () => {
    const controller = createController([
      { success: true, clarification: 'Which tone?' },
      { success: false, error: 'offline' },
    ]);
    const reject = jest.fn();
    render(<I18nProvider i18n={createI18n()}><InlineEditView controller={controller} onAccept={jest.fn()} onReject={reject} /></I18nProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rewrite' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(screen.getByText('Which tone?')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'formal' } });
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'offline');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it('mounts in the owner document and disposes an active predecessor', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument!;
    const ownerWindow = iframe.contentWindow!;
    const firstContainer = ownerDocument.createElement('div');
    const secondContainer = ownerDocument.createElement('div');
    ownerDocument.body.append(firstContainer, secondContainer);
    const firstReject = jest.fn();
    const options = {
      ownerDocument, ownerWindow, i18n: createI18n(), port: {} as InlineEditPort,
      context: { mode: 'selection' as const, selectedText: 'old' }, notePath: 'note.md', service: createService([]), accept: jest.fn(), reject: firstReject,
    };
    let first: MountedInlineEdit;
    let second: MountedInlineEdit;
    act(() => { first = mountInlineEdit({ ...options, container: firstContainer }); });
    act(() => { second = mountInlineEdit({ ...options, container: secondContainer, reject: jest.fn() }); });
    expect(firstReject).toHaveBeenCalledTimes(1);
    expect(firstContainer).toBeEmptyDOMElement();
    act(() => { second.dispose(); second.dispose(); });
    expect(secondContainer).toBeEmptyDOMElement();
    act(() => first.dispose());
  });
  it('unmounts the React widget when CodeMirror removes its decoration', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ extensions: [inlineEditWidgetField] }) });
    const options = {
      container: document.createElement('div'), ownerDocument: document, ownerWindow: window, i18n: createI18n(),
      port: {} as InlineEditPort, context: { mode: 'selection' as const, selectedText: 'old' },
      notePath: 'note.md', service: createService([]), accept: jest.fn(), reject: jest.fn(),
    };
    act(() => view.dispatch({ effects: showInlineEditWidget.of({ pos: 0, block: false, options }) }));
    expect(parent.querySelector('.pivi-inline-react-root')).not.toBeNull();
    act(() => view.dispatch({ effects: hideInlineEditWidget.of(null) }));
    expect(parent.querySelector('.pivi-inline-react-root')).toBeNull();
    view.destroy();
  });
});
