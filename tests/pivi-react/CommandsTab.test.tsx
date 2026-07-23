import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: { locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true, deferMathRenderingDuringStreaming: true, enableAutoTitleGeneration: false, userName: '', excludedTags: [], requireCommandOrControlEnterToSend: false, keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' }, editorSelectionToolbar: { enabled: true, shortcuts: [] } },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

const command: SlashCatalogEntry = { id: 'review', kind: 'command', name: 'review', description: 'Review text', argumentHint: 'text', icon: 'sparkles', integrationKey: 'review-key', content: 'Review {{selected_text}}', scope: 'workspace', source: 'user', isEditable: true, isDeletable: true, displayPrefix: '/', insertPrefix: '/', persistenceKey: 'commands/review.md' };
const compactCommand: SlashCatalogEntry = { id: 'compact', kind: 'command', name: 'compact', description: 'Compact this session to preserve context', content: '/compact', scope: 'builtin', source: 'builtin', isEditable: false, isDeletable: false, displayPrefix: '/', insertPrefix: '/' };
const imageTool: SlashCatalogEntry = { id: 'generate-image', kind: 'tool', name: 'generate-image', description: 'Generate an image', content: '', toolName: 'obsidian_generate_image', scope: 'builtin', source: 'builtin', isEditable: false, isDeletable: false, displayPrefix: '', insertPrefix: '/' };

function createMentionEditorPort(): SettingsPorts['mentionEditor'] {
  return {
    mount(container, initialValue, callbacks) {
      const textarea = document.createElement('textarea');
      textarea.className = 'pivi-settings-control pivi-settings-control--fill pivi-template-textarea';
      textarea.value = initialValue;
      textarea.addEventListener('input', () => callbacks.onChange?.(textarea.value));
      textarea.addEventListener('change', () => callbacks.onChange?.(textarea.value));
      container.appendChild(textarea);
      return {
        getValue: () => textarea.value,
        setValue: (text: string) => { textarea.value = text; },
        focus: () => textarea.focus(),
        setDisabled: (disabled: boolean) => { textarea.disabled = disabled; },
        destroy: () => textarea.remove(),
      };
    },
  };
}

function createPorts(entries: readonly SlashCatalogEntry[], overrides: Partial<SettingsPorts['complex']['commands']> = {}): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    feedback: { notify: jest.fn() },
    actions: { saveGeneral: async () => undefined, saveSubagents: async () => undefined, saveEditorSelectionToolbar: async () => undefined, purgeDeletedSessionFiles: async () => 0 },
    complex: {
      commands: {
        refresh: async () => undefined,
        listIconNames: () => ['list-collapse', 'message-square', 'sparkles'],
        listWorkspaceEntries: async () => entries,
        listDropdownEntries: async () => entries,
        saveWorkspaceEntry: async entry => entry,
        deleteWorkspaceEntry: async () => undefined,
        saveWorkspaceOrder: async () => undefined,
        ...overrides,
      },
    } as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: { getActiveEnvironmentVariables: () => '', getEnvironmentVariables: () => '', applyEnvironmentVariables: async () => undefined, applyEnvironmentVariablesBatch: async () => undefined, importEnvironmentText: async () => undefined, listEntries: () => [], getReviewKeys: () => [] },
    hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    editorToolbar: { listHostCommands: () => [], listPiviCommands: async () => [], listIconNames: () => [], isNoteToolbarTextToolbarActive: () => false },
    catalog: { listModelsForProvider: () => [], syncCustomProviders: () => undefined, fetchCustomProviderModels: async () => ({ count: 0 }) },
    hostIntegrations: { listSections: async () => [], runAction: async () => ({}) },
    mentionEditor: createMentionEditorPort(),
  };
}

function renderCommands(ports: SettingsPorts) {
  render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}><SettingsRoot ports={ports} initialTab="commands" /></I18nProvider>));
}

function getCommandCard(label: 'Create custom slash command' | 'Edit custom slash command'): HTMLElement {
  return screen.getByLabelText(label);
}

describe('React commands settings', () => {
  it('shows built-in commands separately and custom commands as collapsed provider cards', async () => {
    renderCommands(createPorts([command], {
      listDropdownEntries: async () => [command, compactCommand, imageTool],
    }));

    expect(await screen.findByText('Internal commands')).toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.queryByText('/generate-image')).not.toBeInTheDocument();
    const card = getCommandCard('Edit custom slash command');
    expect(card).toHaveClass('pivi-provider-card', 'pivi-command-card');
    expect(card).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Delete command review' })).toBeInTheDocument();
  });

  it('reorders custom commands with the keyboard and saves the id order once on drop', async () => {
    const second: SlashCatalogEntry = { ...command, id: 'explain', name: 'explain', integrationKey: 'explain-key', persistenceKey: 'commands/explain.md' };
    const saveWorkspaceOrder = jest.fn(async () => undefined);
    renderCommands(createPorts([command, second], { saveWorkspaceOrder }));

    const handle = await screen.findByRole('button', { name: 'Reorder /review, currently position 1' });
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(saveWorkspaceOrder).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(saveWorkspaceOrder).toHaveBeenCalledTimes(1);
    expect(saveWorkspaceOrder).toHaveBeenCalledWith(['explain', 'review']);
    expect(screen.getByRole('button', { name: 'Reorder /review, currently position 2' })).toBeInTheDocument();
  });

  it('rolls the command order back when saving the order fails', async () => {
    const second: SlashCatalogEntry = { ...command, id: 'explain', name: 'explain', integrationKey: 'explain-key', persistenceKey: 'commands/explain.md' };
    const saveWorkspaceOrder = jest.fn(async () => { throw new Error('disk unavailable'); });
    const ports = createPorts([command, second], { saveWorkspaceOrder });
    renderCommands(ports);

    const handle = await screen.findByRole('button', { name: 'Reorder /review, currently position 1' });
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);

    expect(ports.feedback.notify).toHaveBeenCalledWith('disk unavailable');
    expect(screen.getByRole('button', { name: 'Reorder /review, currently position 1' })).toBeInTheDocument();
  });

  it('creates an expanded draft card, normalizes it on save, and supports cancelling the draft', async () => {
    const saveWorkspaceEntry = jest.fn(async (entry: SlashCatalogEntry) => ({ ...entry, integrationKey: 'created-key' }));
    renderCommands(createPorts([], { saveWorkspaceEntry }));
    expect(await screen.findByText('No custom commands yet. Add one to make it available from the / menu.')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add custom command' });
    expect(addButton).toHaveTextContent('+ Add command');
    expect(addButton.closest('.pivi-slash-settings-container')?.lastElementChild).toContainElement(addButton);
    fireEvent.click(addButton);
    const draft = getCommandCard('Create custom slash command');
    expect(draft).toHaveAttribute('open');
    const inputs = draft.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'My Command!' } });
    fireEvent.change(draft.querySelector('textarea')!, { target: { value: 'Use this.' } });
    fireEvent.click(within(draft).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mycommand',
      name: 'mycommand',
      argumentHint: 'mycommand',
      content: 'Use this.',
    })));
    await waitFor(() => expect(screen.queryByLabelText('Create custom slash command')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Add custom command' }));
    fireEvent.click(within(getCommandCard('Create custom slash command')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Create custom slash command')).not.toBeInTheDocument();
  });

  it('appends a new command draft after existing commands', async () => {
    renderCommands(createPorts([command]));
    const existingCard = await screen.findByLabelText('Edit custom slash command');
    const addButton = screen.getByRole('button', { name: 'Add custom command' });

    fireEvent.click(addButton);
    const draft = getCommandCard('Create custom slash command');

    expect(existingCard.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(draft.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps unsaved edits while collapsing and selects an icon from the visual grid', async () => {
    renderCommands(createPorts([command]));
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    const description = card.querySelectorAll('input')[1]!;
    fireEvent.change(description, { target: { value: 'Changed locally' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Choose icon' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an icon' });
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search icons' }), { target: { value: 'message' } });
    fireEvent.click(within(picker).getByRole('option', { name: 'message-square' }));
    fireEvent.click(screen.getByLabelText('Edit command review'));
    fireEvent.click(screen.getByLabelText('Edit command review'));
    expect(card.querySelectorAll('input')[1]).toHaveValue('Changed locally');
    expect(within(card).getByRole('button', { name: 'Choose icon' })).toHaveTextContent('message-square');
  });

  it('prioritizes common icons and incrementally reveals the complete icon list', async () => {
    const fillerIcons = Array.from({ length: 160 }, (_, index) => `icon-${index}`);
    renderCommands(createPorts([command], {
      listIconNames: () => [...fillerIcons, 'languages', 'sparkles'],
    }));
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    fireEvent.click(within(card).getByRole('button', { name: 'Choose icon' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an icon' });

    expect(within(picker).getByRole('option', { name: 'languages' })).toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: 'icon-159' })).not.toBeInTheDocument();
    fireEvent.scroll(within(picker).getByRole('listbox', { name: 'Icon results' }));
    expect(within(picker).getByRole('option', { name: 'icon-159' })).toBeInTheDocument();
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: '翻译' },
    });
    expect(within(picker).queryByRole('option', { name: 'languages' })).not.toBeInTheDocument();
  });

  it('closes the icon selector when clicking outside it', async () => {
    renderCommands(createPorts([command]));
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    fireEvent.click(within(card).getByRole('button', { name: 'Choose icon' }));
    expect(screen.getByRole('dialog', { name: 'Choose an icon' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('dialog', { name: 'Choose an icon' })).not.toBeInTheDocument();
  });

  it('saves the command prompt and collapses the card', async () => {
    const saveWorkspaceEntry = jest.fn(async (entry: SlashCatalogEntry) => ({ ...entry, integrationKey: 'review-key' }));
    const ports = createPorts([command], { saveWorkspaceEntry });
    renderCommands(ports);
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    fireEvent.change(card.querySelector('textarea')!, { target: { value: 'Updated prompt' } });

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Updated prompt',
    })));
    expect(card).not.toHaveAttribute('open');
  });

  it('places the prompt description below its label and keeps the editor full width', async () => {
    renderCommands(createPorts([command]));
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    const promptField = within(card).getByText('Prompt').closest('label');
    const description = within(card).getByText('Instructions sent when the command runs.');
    const editorContainer = card.querySelector('.pivi-settings-mention-editor-container');
    const textarea = card.querySelector('textarea');

    expect(promptField).not.toBeNull();
    expect(textarea).toHaveClass('pivi-settings-control--fill');
    expect(promptField?.children[1]).toBe(description);
    expect(promptField?.children[2]).toBe(editorContainer);
  });

  it('keeps the Save button enabled', async () => {
    renderCommands(createPorts([command]));
    await screen.findByText('/review');
    fireEvent.click(screen.getByLabelText('Edit command review'));
    const card = getCommandCard('Edit custom slash command');
    expect(within(card).getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('shows a delete failure rather than leaving the command busy', async () => {
    const deleteWorkspaceEntry = jest.fn(async () => { throw new Error('disk unavailable'); });
    const ports = createPorts([command], { deleteWorkspaceEntry });
    renderCommands(ports);
    const remove = await screen.findByRole('button', { name: 'Delete command review' });
    fireEvent.click(remove);
    const dialog = await screen.findByRole('dialog', { name: /Delete custom command/ });
    const confirmDelete = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmDelete);
    expect(confirmDelete).toBeDisabled();
    await waitFor(() => expect(ports.feedback.notify).toHaveBeenCalledWith('Failed to delete custom command: disk unavailable'));
    expect(screen.queryByRole('dialog')).toBeNull();
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
