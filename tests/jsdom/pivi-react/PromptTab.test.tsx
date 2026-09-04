import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider, SettingsRoot } from '@pivi/pivi-react';
import type {
  SettingsPorts,
  SettingsPromptModuleView,
  SettingsPromptPort,
  SettingsPromptUsageSnapshot,
} from '@pivi/pivi-react/ports';
import type { SettingsUiSnapshotData } from '@pivi/pivi-react/settings';

import { withTestPresentationPlatform } from '../../helpers/presentationPlatform';

const snapshot: SettingsUiSnapshotData = {
  general: {
    locale: 'en', chatViewPlacement: 'right-sidebar', tabBarPosition: 'input', enableAutoScroll: true,
    deferMathRenderingDuringStreaming: true, showCacheHitRate: true, showTokensPerSecond: true,
    enableAutoTitleGeneration: false, userName: '', excludedTags: [], deletedSessionRetentionDays: 30,
    providerRequestDeadlines: { totalMs: 600_000, idleMs: 120_000 },
    requireCommandOrControlEnterToSend: false,
    
    editorSelectionToolbar: { enabled: true, shortcuts: [] },
  },
  subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
};

const coreModule: SettingsPromptModuleView = {
  id: 'identity',
  kind: 'core',
  title: 'Identity & Role',
  enabled: true,
  modified: false,
  body: 'You are Pivi.',
};

const workflowModule: SettingsPromptModuleView = {
  id: 'transcript-cleanup',
  kind: 'workflow',
  title: 'Transcript cleanup',
  enabled: true,
  modified: true,
  body: 'CUSTOM TRANSCRIPT BODY',
};

const customAlpha: SettingsPromptModuleView = {
  id: 'custom:alpha',
  kind: 'custom',
  title: 'Alpha',
  enabled: true,
  modified: false,
  body: 'Alpha body',
};

const customBeta: SettingsPromptModuleView = {
  id: 'custom:beta',
  kind: 'custom',
  title: 'Beta',
  enabled: true,
  modified: false,
  body: 'Beta body',
};

const defaultUsage: SettingsPromptUsageSnapshot = {
  sections: [
    { id: 'core', estimatedTokens: 5_139 },
    { id: 'workflow', estimatedTokens: 309 },
    { id: 'custom', estimatedTokens: 0 },
    { id: 'tools', estimatedTokens: 5_916 },
    { id: 'mcp', estimatedTokens: 129 },
  ],
  totalEstimatedTokens: 11_493,
};

function createPorts(prompt: SettingsPromptPort): SettingsPorts {
  return {
    snapshot: { getSnapshot: () => snapshot },
    feedback: { notify: jest.fn() },
    actions: {
      saveGeneral: async () => undefined,
      saveSubagents: async () => undefined,
      saveEditorSelectionToolbar: async () => undefined,
      purgeDeletedSessionFiles: async () => 0,
    },
    complex: {
      commands: {
        refresh: async () => undefined,
        listIconNames: () => [],
        listWorkspaceEntries: async () => [],
        listDropdownEntries: async () => [],
        saveWorkspaceEntry: async (entry: never) => entry,
        deleteWorkspaceEntry: async () => undefined,
        saveWorkspaceOrder: async () => undefined,
      },
    } as unknown as SettingsPorts['complex'],
    persistence: { getSettingsSnapshot: () => ({} as never), commitSettingsSnapshot: async () => undefined },
    environment: {
      getActiveEnvironmentVariables: () => '',
      getEnvironmentVariables: () => '',
      applyEnvironmentVariables: async () => undefined,
      applyEnvironmentVariablesBatch: async () => undefined,
      importEnvironmentText: async () => undefined,
      listEntries: () => [],
      getReviewKeys: () => [],
    },
    hotkeys: { listHotkeys: () => [], openHotkeySettings: () => undefined },
    editorToolbar: {
      listHostCommands: () => [],
      listPiviCommands: async () => [],
      listIconNames: () => [],
      isNoteToolbarTextToolbarActive: () => false,
    },
    catalog: {
      listModelsForProvider: () => [],
      listCatalogModels: () => [],
      syncCustomProviders: () => undefined,
      fetchCustomProviderModels: async () => ({ count: 0 }),
    },
    hostIntegrations: { listSections: () => [], runAction: async () => ({}) },
    mentionEditor: {
      mount: () => ({
        getValue: () => '',
        setValue: () => undefined,
        focus: () => undefined,
        setDisabled: () => undefined,
        destroy: () => undefined,
      }),
    },
    about: {
      getSnapshot: () => ({
        version: '0.19.4',
        releasedAt: '2026-08-29',
        githubUrl: 'https://github.com/shuuul/obsidian-pivi',
        issuesUrl: 'https://github.com/shuuul/obsidian-pivi/issues',
      }),
    },
    prompt,
  };
}

function createMutablePromptPort(
  initialModules: readonly SettingsPromptModuleView[],
  usage: SettingsPromptUsageSnapshot = defaultUsage,
): SettingsPromptPort & { readonly calls: { restore: number; toggle: number } } {
  let modules = [...initialModules];
  let catalogRevision = 1;
  const calls = { restore: 0, toggle: 0 };
  return {
    calls,
    getCatalogRevision: () => catalogRevision,
    listModules: () => modules,
    getUsage: () => usage,
    setWorkflowEnabled: async (id, enabled) => {
      calls.toggle += 1;
      modules = modules.map((module) => (module.id === id ? { ...module, enabled } : module));
      catalogRevision += 1;
    },
    saveCustomBody: async (id, customBody) => {
      modules = modules.map((module) => (
        module.id === id ? { ...module, body: customBody, modified: true } : module
      ));
      catalogRevision += 1;
    },
    restoreShipped: async (id) => {
      calls.restore += 1;
      modules = modules.map((module) => (
        module.id === id
          ? { ...module, modified: false, body: 'SHIPPED TRANSCRIPT BODY' }
          : module
      ));
      catalogRevision += 1;
    },
    createCustomModule: async (input) => {
      const created: SettingsPromptModuleView = {
        id: 'custom:created',
        kind: 'custom',
        title: input?.title ?? 'New module',
        enabled: input?.enabled ?? true,
        modified: false,
        body: input?.body ?? '',
      };
      modules = [...modules, created];
      catalogRevision += 1;
      return created;
    },
    renameCustomModule: async (id, title) => {
      modules = modules.map((module) => (module.id === id ? { ...module, title } : module));
      catalogRevision += 1;
    },
    editCustomModule: async (id, body) => {
      modules = modules.map((module) => (module.id === id ? { ...module, body } : module));
      catalogRevision += 1;
    },
    reorderCustomModules: async (ids) => {
      const custom = modules.filter((module) => module.kind === 'custom');
      const rest = modules.filter((module) => module.kind !== 'custom');
      const byId = new Map(custom.map((module) => [module.id, module]));
      modules = [...rest, ...ids.flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [entry] : [];
      })];
      catalogRevision += 1;
    },
    setCustomModuleEnabled: async (id, enabled) => {
      modules = modules.map((module) => (module.id === id ? { ...module, enabled } : module));
      catalogRevision += 1;
    },
    deleteCustomModule: async (id) => {
      modules = modules.filter((module) => module.id !== id);
      catalogRevision += 1;
    },
  };
}

function renderPrompt(ports: SettingsPorts) {
  return render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>
      <SettingsRoot ports={ports} page="prompt" />
    </I18nProvider>,
  ));
}

describe('React prompt settings', () => {
  it('hides locked core modules and keeps them out of the editor list', () => {
    renderPrompt(createPorts(createMutablePromptPort([coreModule, workflowModule])));
    expect(screen.queryByText('Identity & Role')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Core' })).not.toBeInTheDocument();
    expect(screen.getByText('Transcript cleanup')).toBeInTheDocument();
    expect(document.querySelector('.pivi-settings-card')).not.toBeNull();
  });

  it('toggles workflow modules, shows a modified badge, and restores the shipped body', async () => {
    const prompt = createMutablePromptPort([coreModule, workflowModule]);
    renderPrompt(createPorts(prompt));

    const card = screen.getByText('Transcript cleanup').closest('.pivi-settings-card') as HTMLElement;
    expect(within(card).getByText('Modified')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('checkbox', { name: 'Disable Transcript cleanup' }));
    await act(async () => undefined);
    expect(prompt.calls.toggle).toBe(1);
    expect(within(card).getByRole('checkbox', { name: 'Enable Transcript cleanup' })).not.toBeChecked();

    fireEvent.click(within(card).getByRole('button', { expanded: false, name: /Transcript cleanup/ }));
    const restore = within(card).getByRole('button', { name: 'Restore default' });
    expect(restore).not.toBeDisabled();
    fireEvent.click(restore);
    await act(async () => undefined);
    expect(prompt.calls.restore).toBe(1);
    expect(within(card).queryByText('Modified')).not.toBeInTheDocument();
    const editor = within(card).getByRole('textbox');
    expect(editor).toHaveValue('SHIPPED TRANSCRIPT BODY');
    expect(editor).toHaveAttribute('rows', '16');
  });

  it('adds, reorders, and delete-confirms custom modules', async () => {
    const prompt = createMutablePromptPort([coreModule, customAlpha, customBeta]);
    renderPrompt(createPorts(prompt));

    const add = screen.getByRole('button', { name: 'Add custom prompt module' });
    expect(add).toHaveTextContent('+ Add module');
    fireEvent.click(add);
    const draftTitle = screen.getByText('New module').closest('.pivi-settings-card') as HTMLElement;
    expect(draftTitle).toHaveClass('is-open');
    expect(screen.queryByRole('button', { name: 'Reorder New module, currently position 3' })).not.toBeInTheDocument();

    fireEvent.change(within(draftTitle).getAllByRole('textbox')[0]!, { target: { value: 'Gamma' } });
    fireEvent.change(within(draftTitle).getAllByRole('textbox')[1]!, { target: { value: 'Gamma body' } });
    fireEvent.click(within(draftTitle).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
    expect(screen.queryByText('No custom modules yet. Add one to append it after workflow modules.')).not.toBeInTheDocument();

    const handle = screen.getByRole('button', { name: 'Reorder Alpha, currently position 1' });
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: ' ' });
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Reorder Alpha, currently position 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Alpha/ }));
    expect(screen.getByText('Alpha').closest('.pivi-settings-card')).toHaveClass('is-open');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument());
    expect(screen.getByText('Alpha').closest('.pivi-settings-card')).toHaveClass('is-open');
  });

  it('renders compact usage estimates without a suggested-budget warning', () => {
    renderPrompt(createPorts(createMutablePromptPort([coreModule], defaultUsage)));
    expect(screen.getByRole('heading', { name: 'Startup context' })).toBeInTheDocument();
    expect(screen.getByLabelText('Estimated startup prompt composition')).toBeInTheDocument();
    expect(screen.getByText('6K estimate')).toBeInTheDocument();
    expect(screen.getByText('5K estimate')).toBeInTheDocument();
    expect(screen.getByText('11K estimate')).toBeInTheDocument();
    expect(screen.getByText('309 estimate')).toBeInTheDocument();
    expect(screen.queryByText('Over suggested budget')).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggested /)).not.toBeInTheDocument();
    expect(document.querySelector('.pivi-prompt-usage__row.is-warning')).toBeNull();
    expect(document.querySelector('.pivi-prompt-usage__segment--tools.is-warning')).toBeNull();
  });
});
