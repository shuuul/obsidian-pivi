import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true, autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

const command: SlashCatalogEntry = { id: 'review', kind: 'command', name: 'review', description: 'Review text', argumentHint: 'text', icon: 'sparkles', integrationKey: 'review-key', content: 'Review {{selected_text}}', scope: 'workspace', source: 'user', isEditable: true, isDeletable: true, displayPrefix: '/', insertPrefix: '/', persistenceKey: 'commands/review.md' };
const compactCommand: SlashCatalogEntry = { id: 'compact', kind: 'command', name: 'compact', description: 'Compact this session to preserve context', content: '/compact', scope: 'builtin', source: 'builtin', isEditable: false, isDeletable: false, displayPrefix: '/', insertPrefix: '/' };
const imageTool: SlashCatalogEntry = { id: 'generate-image', kind: 'tool', name: 'generate-image', description: 'Generate an image', content: '', toolName: 'obsidian_generate_image', scope: 'builtin', source: 'builtin', isEditable: false, isDeletable: false, displayPrefix: '', insertPrefix: '/' };

function createPorts(entries: readonly SlashCatalogEntry[], overrides: Partial<SettingsPorts['complex']['commands']> = {}): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0 },
    complex: {
      commands: { refresh: async () => undefined, listIconNames: () => ['list-collapse', 'message-square', 'sparkles'], listWorkspaceEntries: async () => entries, listDropdownEntries: async () => entries, saveWorkspaceEntry: async entry => entry, deleteWorkspaceEntry: async () => undefined, setupNoteToolbar: async () => ({ message: 'Added command to Note Toolbar.' }), ...overrides },
    } as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: () => [], runAction: async () => ({}) },
  };
}

function renderCommands(ports: SettingsPorts) {
  render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="commands" /></I18nProvider>));
}

describe('React commands settings', () => {
  it('shows builtin commands as read-only internal commands', async () => {
    renderCommands(createPorts([command], {
      listDropdownEntries: async () => [command, compactCommand, imageTool],
    }));

    expect(await screen.findByText('Internal commands')).toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText('Compact this session to preserve context')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit command compact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete command compact' })).not.toBeInTheDocument();
    expect(screen.queryByText('/generate-image')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit command review' })).toBeInTheDocument();
  });

  it('loads vault commands and creates a normalized command', async () => {
    const saveWorkspaceEntry = jest.fn(async (entry: SlashCatalogEntry) => ({
      ...entry,
      integrationKey: 'created-key',
    }));
    renderCommands(createPorts([], { saveWorkspaceEntry }));
    expect(await screen.findByText('No custom commands yet. Add one to make it available from the / menu.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add custom command' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create custom slash command' });
    expect(dialog).toHaveClass('pivi-modal-layer');
    expect(dialog.querySelector('.pivi-modal')).not.toBeNull();
    expect(dialog.querySelectorAll('.pivi-setting-row')).toHaveLength(5);
    expect(within(dialog).getByRole('button', { name: 'Create' })).toHaveClass('pivi-button--primary');
    expect(dialog.querySelector('[class*="setting-item"], [class^="modal-"]')).toBeNull();
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'My Command!' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Use this.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await act(async () => undefined);
    expect(saveWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'mycommand', name: 'mycommand', argumentHint: 'mycommand', icon: 'message-square', content: 'Use this.' }));
    expect(screen.queryByRole('dialog', { name: 'Create custom slash command' })).not.toBeInTheDocument();
  });

  it('selects an icon from a searchable visual grid', async () => {
    const saveWorkspaceEntry = jest.fn(async (entry: SlashCatalogEntry) => entry);
    renderCommands(createPorts([], { saveWorkspaceEntry }));

    fireEvent.click(await screen.findByRole('button', { name: 'Add custom command' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create custom slash command' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose icon' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an icon' });
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'spark' },
    });
    fireEvent.click(within(picker).getByRole('option', { name: 'sparkles' }));

    expect(screen.queryByRole('dialog', { name: 'Choose an icon' })).not.toBeInTheDocument();
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'polish' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Polish this.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(saveWorkspaceEntry).toHaveBeenCalledWith(
      expect.objectContaining({ icon: 'sparkles' }),
    ));
  });

  it('closes after saving before adding an icon-only command to Note Toolbar', async () => {
    const saveWorkspaceEntry = jest.fn(async (entry: SlashCatalogEntry) => ({
      ...entry,
      integrationKey: 'created-key',
    }));
    let finishSetup!: () => void;
    const setupNoteToolbar = jest.fn(() => new Promise<{ message: string }>((resolve) => {
      finishSetup = () => resolve({ message: 'Added command to Note Toolbar.' });
    }));
    renderCommands(createPorts([], { saveWorkspaceEntry, setupNoteToolbar }));

    fireEvent.click(await screen.findByRole('button', { name: 'Add custom command' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create custom slash command' });
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'summarize' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Summarize {{selected_text}}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and add to Note Toolbar' }));

    await waitFor(() => expect(setupNoteToolbar).toHaveBeenCalledWith(
      expect.objectContaining({ integrationKey: 'created-key', icon: 'message-square' }),
    ));
    expect(screen.queryByRole('dialog', { name: 'Create custom slash command' })).not.toBeInTheDocument();
    await act(async () => finishSetup());
    expect(screen.getByRole('status')).toHaveTextContent('Added command to Note Toolbar.');
  });

  it('shows a failure rather than leaving a command action busy', async () => {
    const deleteWorkspaceEntry = jest.fn(async () => { throw new Error('disk unavailable'); });
    renderCommands(createPorts([command], { deleteWorkspaceEntry }));
    const remove = await screen.findByRole('button', { name: 'Delete command review' });
    fireEvent.click(remove);
    const dialog = await screen.findByRole('dialog', { name: /Delete custom command/ });
    const confirmDelete = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirmDelete).toHaveClass('pivi-button--danger');
    fireEvent.click(confirmDelete);
    expect(confirmDelete).toBeDisabled();
    await act(async () => undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete custom command: disk unavailable');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete command review' })).not.toBeDisabled();
  });

  it('does not update state after the tab unmounts during its initial load', async () => {
    let resolve!: (entries: readonly SlashCatalogEntry[]) => void;
    const listWorkspaceEntries = jest.fn(() => new Promise<readonly SlashCatalogEntry[]>((done) => { resolve = done; }));
    const { unmount } = render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts([], { listWorkspaceEntries })} initialTab="commands" /></I18nProvider>));
    await waitFor(() => expect(listWorkspaceEntries).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => resolve([command]));
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(1);
  });
});
