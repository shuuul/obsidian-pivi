import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsUiStore } from '@pivi/pivi-react';
import { EditorToolbarSection } from '@pivi/pivi-react/settings';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: {
    locale: 'en',
    chatViewPlacement: 'right-sidebar',
    tabBarPosition: 'input',
    enableAutoScroll: true,
    deferMathRenderingDuringStreaming: true,
    showCacheHitRate: true,
    showTokensPerSecond: true,
    enableAutoTitleGeneration: false,
    userName: '',
    excludedTags: [],
    providerRequestDeadlines: { totalMs: 600_000, idleMs: 120_000 },
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
        { id: 'editor:toggle-bold', name: 'Bold', iconId: 'bold' },
        { id: 'workspace:toggle-pin', name: 'Toggle pin', iconId: 'pin' },
      ],
      listPiviCommands: async () => [
        {
          key: 'cmd-key-1',
          name: 'summarize',
          description: 'Summarize selection',
          icon: 'scan-text',
        },
      ],
      listIconNames: () => ['fold-vertical', 'pin', 'scan-text', 'terminal'],
      isNoteToolbarTextToolbarActive: () => false,
    },
  };
}

describe('EditorToolbarSection', () => {
  it('refreshes Pivi command shortcut metadata from the command catalog', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [{
            id: 'shortcut-1',
            kind: 'pivi-command' as const,
            label: '/old-name',
            enabled: true,
            piviCommandKey: 'cmd-key-1',
            icon: 'old-icon',
            executionTarget: 'sidebar' as const,
          }],
        },
      },
    });
    const ports = createPorts(saveEditorSelectionToolbar);
    const listPiviCommands = ports.editorToolbar.listPiviCommands;
    let resolveCommands!: (
      commands: Awaited<ReturnType<typeof listPiviCommands>>,
    ) => void;
    const pendingCommands = new Promise<Awaited<ReturnType<typeof listPiviCommands>>>(
      (resolve) => { resolveCommands = resolve; },
    );
    ports.editorToolbar.listPiviCommands = jest.fn(() => pendingCommands);

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
    await act(async () => {
      resolveCommands(await listPiviCommands());
      await Promise.resolve();
    });

    await screen.findByText('/summarize');
    expect(screen.queryByText('/old-name')).not.toBeInTheDocument();
    expect(document.querySelector('[data-test-icon="scan-text"]')).not.toBeNull();
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts[0]).toMatchObject({
      label: '/summarize',
      icon: 'scan-text',
      executionTarget: 'sidebar',
    });
    expect(saveEditorSelectionToolbar).not.toHaveBeenCalled();
  });

  it('keeps shortcut configuration in a local disclosure panel', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [{
            id: 'shortcut-1',
            kind: 'pivi-command' as const,
            label: '/summarize',
            enabled: true,
            piviCommandKey: 'cmd-key-1',
            icon: 'scan-text',
            executionTarget: 'sidebar' as const,
          }],
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
    await screen.findByText('Summarize selection');

    const details = screen.getByText('/summarize').closest('.pivi-settings-card');
    const summary = details?.querySelector('.pivi-settings-card__header');
    expect(details).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(details).not.toHaveClass('is-open');
    expect(saveEditorSelectionToolbar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('/summarize'));
    expect(details).toHaveClass('is-open');
    expect(screen.getByRole('combobox', { name: 'Execution target for /summarize' })).toHaveTextContent('Sidebar');
    expect(saveEditorSelectionToolbar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('/summarize'));
    expect(details).not.toHaveClass('is-open');
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Enable /summarize' }));
    });
    expect(details).not.toHaveClass('is-open');
    expect(saveEditorSelectionToolbar).toHaveBeenCalledWith({
      enabled: true,
      shortcuts: [expect.objectContaining({ id: 'shortcut-1', enabled: false })],
    });
  });

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
    fireEvent.click(screen.getByRole('combobox', { name: 'Execution target' }));
    fireEvent.click(screen.getByRole('option', { name: 'Inline edit' }));

    expect(screen.getByText('Summarize selection')).toBeInTheDocument();
    expect(screen.queryByText('cmd-key-1')).not.toBeInTheDocument();

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
          executionTarget: 'inline-edit',
        }),
      ],
    });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts).toHaveLength(1);

    const details = screen.getByText('/summarize').closest('.pivi-settings-card');
    expect(details).toHaveClass('is-open');
    const targetSelect = screen.getByRole('combobox', { name: 'Execution target for /summarize' });
    expect(targetSelect).toHaveTextContent('Inline edit');
    fireEvent.click(targetSelect);
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Sidebar' }));
    });
    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: [expect.objectContaining({ executionTarget: 'sidebar' })],
    });

    const removeButton = screen.getByRole('button', { name: 'Remove /summarize' });
    fireEvent.click(removeButton);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    });

    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: [],
    });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts).toHaveLength(0);
  });

  it('adds and removes a compact editor command with canonical metadata', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '+ Add editor command' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Toggle fold/ }));
    });

    expect(document.querySelector('[data-test-icon="fold-vertical"]')).not.toBeNull();
    expect(screen.queryByRole('combobox', { name: /Execution target for Toggle fold/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose icon' })).not.toBeInTheDocument();
    const removeButton = screen.getByRole('button', { name: 'Remove Toggle fold' });
    expect(saveEditorSelectionToolbar).toHaveBeenCalledWith({
      enabled: true,
      shortcuts: [
        expect.objectContaining({
          kind: 'editor-command',
          commandId: 'editor:toggle-fold',
        }),
      ],
    });

    fireEvent.click(removeButton);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    });
    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: [],
    });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts).toHaveLength(0);
  });

  it('shows the complete curated catalog and disables unavailable commands', () => {
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [{
            id: 'editor:toggle-bold',
            kind: 'editor-command' as const,
            commandId: 'editor:toggle-bold' as const,
            enabled: false,
          }],
        },
      },
    });
    const ports = createPorts(async () => undefined);

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

    fireEvent.click(screen.getByRole('button', { name: '+ Add editor command' }));

    expect(screen.getAllByRole('option')).toHaveLength(51);
    expect(screen.getByRole('option', { name: /Toggle fold/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Bold.*Added/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Bold.*Added/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /editor:toggle-italics.*Command not registered/ })).toBeDisabled();
  });

  it('announces when the Obsidian command picker truncates results', () => {
    const store = new SettingsUiStore(snapshot);
    const hostCommands = Array.from({ length: 120 }, (_, index) => ({
      id: `workspace:command-${index}`,
      name: `Command ${index}`,
      iconId: 'terminal',
    }));
    const ports = createPorts(async () => undefined);
    ports.editorToolbar.listHostCommands = () => hostCommands;

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

    expect(screen.getAllByRole('option')).toHaveLength(100);
    expect(screen.getByText('Showing the first 100 matches. Refine your search to see more.')).toBeInTheDocument();
  });

  it('keeps editor and Obsidian command catalogs separate and gives every picker row an icon', async () => {
    let resolveSave!: () => void;
    const saveEditorSelectionToolbar = jest.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
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

    fireEvent.click(screen.getByRole('button', { name: '+ Add editor command' }));
    expect(screen.getByRole('option', { name: /Toggle fold/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Toggle pin/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Toggle fold/ }).querySelector('.pivi-editor-toolbar-picker__icon')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Add Obsidian command' }));
    const hostOption = screen.getByRole('option', { name: /Toggle pin.*workspace:toggle-pin/ });
    expect(hostOption.querySelector('[data-test-icon="pin"]')).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Toggle fold/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Bold/ })).not.toBeInTheDocument();

    fireEvent.click(hostOption);
    expect(saveEditorSelectionToolbar).toHaveBeenCalledWith({
      enabled: true,
      shortcuts: [expect.objectContaining({
        kind: 'obsidian-command',
        label: 'Toggle pin',
        commandId: 'workspace:toggle-pin',
        icon: 'pin',
        enabled: true,
      })],
    });
    expect(hostOption).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search commands by name or ID' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(saveEditorSelectionToolbar).toHaveBeenCalledTimes(1);

    await act(async () => { resolveSave(); });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Pivi command' }));
    const piviOption = await screen.findByRole('option', { name: /\/summarize/ });
    expect(piviOption.querySelector('[data-test-icon="scan-text"]')).not.toBeNull();
  });

  it('isolates the global toggle, every item toggle, disclosure, and header icon picker', async () => {
    const saveEditorSelectionToolbar = jest.fn(async () => undefined);
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [
            { id: 'inline-edit', kind: 'pivi-action' as const, actionId: 'inline-edit' as const, enabled: true },
            { id: 'add-to-chat', kind: 'pivi-action' as const, actionId: 'add-to-chat' as const, enabled: true },
            { id: 'editor:toggle-bold', kind: 'editor-command' as const, commandId: 'editor:toggle-bold' as const, enabled: true },
            { id: 'host-1', kind: 'obsidian-command' as const, label: 'Toggle pin', commandId: 'workspace:toggle-pin', icon: 'pin', enabled: true },
            { id: 'pivi-1', kind: 'pivi-command' as const, label: '/summarize', piviCommandKey: 'cmd-key-1', icon: 'scan-text', executionTarget: 'sidebar' as const, enabled: true },
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
    await screen.findByText('Summarize selection');

    const globalToggle = screen.getByRole('checkbox', { name: 'Enable selection toolbar' });
    const inlineToggle = screen.getByRole('checkbox', { name: 'Enable Inline edit' });
    const addToChatToggle = screen.getByRole('checkbox', { name: 'Enable Add to chat' });
    const editorToggle = screen.getByRole('checkbox', { name: 'Enable Bold' });
    const obsidianToggle = screen.getByRole('checkbox', { name: 'Enable Toggle pin' });
    const piviToggle = screen.getByRole('checkbox', { name: 'Enable /summarize' });
    const editorRow = screen.getByText('Bold').closest('.pivi-settings-row') as HTMLElement;
    const obsidianRow = screen.getByText('Toggle pin').closest('.pivi-settings-row');
    const piviDetails = screen.getByText('/summarize').closest('.pivi-settings-card');

    const editorKind = within(editorRow).getByText('Editor command');
    const editorRemove = within(editorRow).getByRole('button', { name: 'Remove Bold' });
    expect(editorKind.compareDocumentPosition(editorRemove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editorRemove.compareDocumentPosition(editorToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const piviKind = within(piviDetails as HTMLElement).getByText('Pivi command');
    const piviRemove = within(piviDetails as HTMLElement).getByRole('button', { name: 'Remove /summarize' });
    expect(piviKind.compareDocumentPosition(piviRemove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(piviRemove.compareDocumentPosition(piviToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(globalToggle).toBeChecked();
    expect(inlineToggle).toBeChecked();
    expect(addToChatToggle).toBeChecked();
    expect(editorToggle).toBeChecked();
    expect(obsidianToggle).toBeChecked();
    expect(piviToggle).toBeChecked();
    expect(obsidianRow).not.toHaveClass('pivi-settings-card');
    expect(piviDetails).not.toHaveClass('is-open');

    await act(async () => { fireEvent.click(inlineToggle); });
    await act(async () => { fireEvent.click(addToChatToggle); });
    await act(async () => { fireEvent.click(editorToggle); });
    await act(async () => { fireEvent.click(piviToggle); });
    await act(async () => { fireEvent.click(obsidianToggle); });
    expect(globalToggle).toBeChecked();
    expect(inlineToggle).not.toBeChecked();
    expect(addToChatToggle).not.toBeChecked();
    expect(editorToggle).not.toBeChecked();
    expect(obsidianToggle).not.toBeChecked();
    expect(piviToggle).not.toBeChecked();
    expect(piviDetails).not.toHaveClass('is-open');

    const iconButton = screen.getByRole('button', { name: 'Choose icon' });
    expect(iconButton.closest('.pivi-settings-row')).toBe(obsidianRow);
    expect(piviDetails).not.toHaveClass('is-open');
    fireEvent.click(iconButton);
    expect(piviDetails).not.toHaveClass('is-open');
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'terminal' }));
    });
    expect(piviDetails).not.toHaveClass('is-open');
    expect(saveEditorSelectionToolbar).toHaveBeenLastCalledWith({
      enabled: true,
      shortcuts: expect.arrayContaining([
        expect.objectContaining({ id: 'host-1', enabled: false, icon: 'terminal' }),
      ]),
    });
  });

  it('renders required Pivi actions as immutable rows and safely rolls back one pending save', async () => {
    let rejectSave!: (cause: Error) => void;
    const saveEditorSelectionToolbar = jest.fn(() => new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }));
    const store = new SettingsUiStore({
      ...snapshot,
      general: {
        ...snapshot.general,
        editorSelectionToolbar: {
          enabled: true,
          shortcuts: [
            { id: 'inline-edit', kind: 'pivi-action' as const, actionId: 'inline-edit' as const, enabled: true },
            { id: 'add-to-chat', kind: 'pivi-action' as const, actionId: 'add-to-chat' as const, enabled: true },
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

    expect(screen.getByText('Inline edit').closest('.pivi-settings-row')?.tagName).toBe('DIV');
    expect(screen.getByText('Add to chat').closest('.pivi-settings-row')?.tagName).toBe('DIV');
    expect(screen.queryByRole('button', { name: 'Remove Inline edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Add to chat' })).not.toBeInTheDocument();

    const inlineToggle = screen.getByRole('checkbox', { name: 'Enable Inline edit' });
    const addToChatToggle = screen.getByRole('checkbox', { name: 'Enable Add to chat' });
    fireEvent.click(inlineToggle);
    expect(saveEditorSelectionToolbar).toHaveBeenCalledTimes(1);
    expect(addToChatToggle).toBeDisabled();
    fireEvent.click(addToChatToggle);
    expect(saveEditorSelectionToolbar).toHaveBeenCalledTimes(1);

    await act(async () => { rejectSave(new Error('save failed')); });
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts[0]?.enabled).toBe(true);
    expect(store.getSnapshot().general.editorSelectionToolbar.shortcuts[1]?.enabled).toBe(true);
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
            { id: 'shortcut-2', kind: 'pivi-command' as const, label: '/summarize', enabled: true, piviCommandKey: 'cmd-key-1', icon: 'scan-text', executionTarget: 'sidebar' as const },
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
    const row = screen.getByText('Toggle fold').closest('.pivi-settings-row');
    expect(row).not.toBeNull();
    expect(row?.firstElementChild).toHaveClass('pivi-settings-row__handle');
    expect(screen.getByText('Toggle fold').closest('.pivi-settings-card')).toBeNull();
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
