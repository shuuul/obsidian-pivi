import { act, fireEvent, render, screen } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsUiStore } from '@pivi/pivi-react';
import { EditorToolbarSection } from '@pivi/pivi-react/settings';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: {
    locale: 'en',
    chatViewPlacement: 'right-sidebar',
    tabBarPosition: 'input',
    enableAutoScroll: true,
    deferMathRenderingDuringStreaming: true,
    enableAutoTitleGeneration: false,
    userName: '',
    excludedTags: [],
    requireCommandOrControlEnterToSend: false,
    keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
    editorSelectionToolbar: { enabled: true, shortcuts: [] },
  },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

function createPorts(
  saveEditorSelectionToolbar: SettingsPorts['actions']['saveEditorSelectionToolbar'],
): Pick<SettingsPorts, 'actions' | 'editorToolbar' | 'feedback'> {
  return {
    feedback: { notify: jest.fn() },
    actions: {
      saveGeneral: async () => undefined,
      saveSubagents: async () => undefined,
      saveEditorSelectionToolbar,
      purgeDeletedSessionFiles: async () => 0,
    },
    editorToolbar: {
      listHostCommands: () => [
        { id: 'editor:toggle-fold', name: 'Toggle fold', iconId: 'fold-vertical' },
      ],
      listPiviCommands: async () => [
        {
          key: 'cmd-key-1',
          name: 'summarize',
          description: 'Summarize selection',
          icon: 'scan-text',
        },
      ],
      listIconNames: () => ['fold-vertical', 'scan-text', 'terminal'],
      isNoteToolbarTextToolbarActive: () => false,
    },
  };
}

describe('EditorToolbarSection', () => {
  it('adds and removes a Pivi command shortcut through saveEditorSelectionToolbar', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore(snapshot);
    const ports = createPorts(saveEditorSelectionToolbar);

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <EditorToolbarSection
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
        />
      </I18nProvider>,
    ));

    fireEvent.click(screen.getByRole('button', { name: '+ Add Pivi command' }));
    await screen.findByRole('option', { name: /\/summarize/ });

    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /\/summarize/ }));
    });

    expect(saveEditorSelectionToolbar).toHaveBeenCalledWith({
      enabled: true,
      shortcuts: [
        expect.objectContaining({
          kind: 'pivi-command',
          label: '/summarize',
          enabled: true,
          piviCommandKey: 'cmd-key-1',
          icon: 'scan-text',
        }),
      ],
    });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts).toHaveLength(1);

    const removeButton = screen.getByRole('button', { name: 'Remove /summarize' });
    await act(async () => {
      fireEvent.click(removeButton);
    });

    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: [],
    });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts).toHaveLength(0);
  });

  it('shows and updates the icon for an Obsidian command shortcut', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore(snapshot);
    const ports = createPorts(saveEditorSelectionToolbar);

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <EditorToolbarSection
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
        />
      </I18nProvider>,
    ));

    fireEvent.click(screen.getByRole('button', { name: '+ Add Obsidian command' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Toggle fold/ }));
    });

    const iconButton = screen.getByRole('button', { name: 'Choose icon' });
    expect(iconButton.querySelector('[data-test-icon="fold-vertical"]')).not.toBeNull();

    fireEvent.click(iconButton);
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'terminal' }));
    });

    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: [
        expect.objectContaining({
          commandId: 'editor:toggle-fold',
          icon: 'terminal',
        }),
      ],
    });
  });

  it('reorders shortcuts with the keyboard and persists the new order', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [
            { id: 'shortcut-1', kind: 'obsidian-command' as const, label: 'Toggle fold', enabled: true, commandId: 'editor:toggle-fold', icon: 'fold-vertical' },
            { id: 'shortcut-2', kind: 'pivi-command' as const, label: '/summarize', enabled: true, piviCommandKey: 'cmd-key-1', icon: 'scan-text' },
          ],
        },
      },
    });
    const ports = createPorts(saveEditorSelectionToolbar);

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <EditorToolbarSection
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
        />
      </I18nProvider>,
    ));

    const handle = screen.getByRole('button', { name: 'Reorder Toggle fold, currently position 1' });
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(saveEditorSelectionToolbar).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(saveEditorSelectionToolbar).toHaveBeenCalledTimes(1);
    expect(saveEditorSelectionToolbar).toHaveBeenCalledWith({
      enabled: true,
      shortcuts: [
        expect.objectContaining({ id: 'shortcut-2' }),
        expect.objectContaining({ id: 'shortcut-1' }),
      ],
    });
    expect(
      store.getSnapshot().general.editorSelectionToolbar.shortcuts.map(shortcut => shortcut.id),
    ).toEqual(['shortcut-2', 'shortcut-1']);
    expect(screen.getByRole('button', { name: 'Reorder Toggle fold, currently position 2' })).toBeInTheDocument();
  });

  it('hides shortcut controls when the toolbar is disabled', () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: { enabled: false, shortcuts: [] },
      },
    });
    const ports = createPorts(saveEditorSelectionToolbar);

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <EditorToolbarSection
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
        />
      </I18nProvider>,
    ));

    expect(screen.queryByRole('button', { name: '+ Add Pivi command' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable selection toolbar' })).not.toBeChecked();
  });
});
