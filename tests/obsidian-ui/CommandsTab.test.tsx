import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/obsidian-ui';
import type { SettingsPorts } from '@pivi/obsidian-ui/ports';
import type { SettingsUiSnapshotData } from '@pivi/obsidian-ui/settings';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, autoCompact: true, autoCompactThresholdPercent: 90, autoCompactKeepRecentTokens: 20_000, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

const command: SlashCatalogEntry = { id: 'review', kind: 'command', name: 'review', description: 'Review text', argumentHint: 'text', content: 'Review {{selected_text}}', scope: 'vault', source: 'user', isEditable: true, isDeletable: true, displayPrefix: '/', insertPrefix: '/', persistenceKey: 'commands/review.md' };

function createPorts(entries: readonly SlashCatalogEntry[], overrides: Partial<SettingsPorts['complex']['commands']> = {}): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, purgeDeletedSessionFiles: async () => 0, openStyleSettings: async () => true, setupNoteToolbarIntegration: async () => ({ status: 'installed' }) },
    complex: {
      commands: { refresh: async () => undefined, listVaultEntries: async () => entries, listDropdownEntries: async () => entries, saveVaultEntry: async () => undefined, deleteVaultEntry: async () => undefined, ...overrides },
    } as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, getReviewKeys: () => [] }, hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
  };
}

function renderCommands(ports: SettingsPorts) {
  render(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="commands" /></I18nProvider>);
}

describe('React commands settings', () => {
  it('loads vault commands and creates a normalized command', async () => {
    const saveVaultEntry = jest.fn(async () => undefined);
    renderCommands(createPorts([], { saveVaultEntry }));
    expect(await screen.findByText('No custom commands yet. Add one to make it available from the / menu.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add custom command' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create custom slash command' });
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'My Command!' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Use this.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await act(async () => undefined);
    expect(saveVaultEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'mycommand', name: 'mycommand', content: 'Use this.' }));
  });

  it('shows a failure rather than leaving a command action busy', async () => {
    const deleteVaultEntry = jest.fn(async () => { throw new Error('disk unavailable'); });
    renderCommands(createPorts([command], { deleteVaultEntry }));
    const remove = await screen.findByRole('button', { name: 'Delete command review' });
    fireEvent.click(remove);
    const dialog = await screen.findByRole('dialog', { name: /Delete custom command/ });
    const confirmDelete = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDelete);
    expect(confirmDelete).toBeDisabled();
    await act(async () => undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete custom command: disk unavailable');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete command review' })).not.toBeDisabled();
  });

  it('does not update state after the tab unmounts during its initial load', async () => {
    let resolve!: (entries: readonly SlashCatalogEntry[]) => void;
    const listVaultEntries = jest.fn(() => new Promise<readonly SlashCatalogEntry[]>((done) => { resolve = done; }));
    const { unmount } = render(<I18nProvider i18n={createI18n()}><SettingsRoot ports={createPorts([], { listVaultEntries })} initialTab="commands" /></I18nProvider>);
    await waitFor(() => expect(listVaultEntries).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => resolve([command]));
    expect(listVaultEntries).toHaveBeenCalledTimes(1);
  });
});
