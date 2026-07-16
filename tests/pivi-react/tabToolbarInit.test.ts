import type { ChatSettingsSnapshot } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { ChatState } from '@/ui/chat/state/ChatState';
import { wireComposerChrome } from '@/ui/chat/tabs/tabToolbarInit';
import type { TabData } from '@/ui/chat/tabs/types';
import { createFakeChatPorts } from '../helpers/createFakeChatPorts';
import { asPiviPlugin, createMockPiviPluginStub } from '../helpers/mockPiviPlugin';

function settingsSnapshot(model: string): ChatSettingsSnapshot {
  return {
    model,
    thinkingBudget: 'medium',
    thinkingLevel: 'medium',
    customContextLimits: {},
    enableAutoScroll: true,
    enableAutoTitleGeneration: true,
    titleGenerationModel: '',
    userName: '',
    excludedTags: [],
    keyboardNavigation: {
      scrollUpKey: 'w',
      scrollDownKey: 's',
      focusInputKey: 'i',
    },
    requireCommandOrControlEnterToSend: false,
    environmentVariables: '',
    externalReadDirectories: [],
    hiddenSlashCommands: [],
    showActiveWorkShelf: false,
    modelCatalog: {
      addedProviders: [],
      disabledProviders: [],
      visibleModels: [],
      customProviders: [],
    },
  };
}

function createToolbarTab(state: ChatState): TabData {
  return {
    id: 'tab-1',
    lifecycleState: 'bound_active',
    draftModel: null,
    draftTitle: null,
    openSessionId: 'session-1',
    sessionFile: '.pivi/sessions/session-1.jsonl',
    leafId: null,
    service: { syncThinkingLevel: jest.fn() } as never,
    isArchived: false,
    serviceInitialized: true,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      openSessionController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: { subagentManager: {} as never, titleGenerationService: null },
    ui: {
      fileContextManager: null,
      inlineContextManager: null,
      imageContextManager: null,
      externalContextSelector: null,
      slashCommandDropdown: null,
      composerActions: null,
    },
    dom: {
      richInput: { value: '', el: document.createElement('div') } as never,
      inputWrapper: document.createElement('div'),
    } as never,
    renderer: null,
  };
}

describe('composer model usage limits', () => {
  it('updates the context limit before metadata preparation completes and refreshes it afterward', async () => {
    let settings = settingsSnapshot('provider/small');
    let largeContextWindow = 200_000;
    let finishMetadata: (() => void) | undefined;
    const prepareModelMetadata = jest.fn(() => new Promise<void>((resolve) => {
      finishMetadata = resolve;
    }));
    const ports = createFakeChatPorts({
      models: {
        getModelOptions: current => [
          { label: 'Small', value: current.model },
          { label: 'Large', value: 'provider/large' },
        ],
        getContextWindowSize: model => model === 'provider/large' ? largeContextWindow : 100_000,
        prepareModelMetadata,
      },
      settings: {
        getSettingsSnapshot: () => ({ ...settings }),
        commitSettingsSnapshot: async next => { settings = { ...next }; },
      },
    });
    const state = new ChatState();
    state.usage = {
      contextTokens: 50_000,
      contextWindow: 100_000,
      inputTokens: 50_000,
      model: 'provider/small',
      percentage: 50,
    };
    const tab = createToolbarTab(state);
    wireComposerChrome(tab, asPiviPlugin(createMockPiviPluginStub()), ports);

    tab.ui.composerActions?.setModel('provider/large');
    await Promise.resolve();
    await Promise.resolve();

    expect(prepareModelMetadata).toHaveBeenCalledWith('provider/large');
    expect(state.usage).toMatchObject({
      contextWindow: 200_000,
      model: 'provider/large',
      percentage: 25,
    });

    largeContextWindow = 256_000;
    finishMetadata?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.usage).toMatchObject({
      contextWindow: 256_000,
      model: 'provider/large',
      percentage: 20,
    });
  });

  it('does not let a slower previous model selection overwrite the current limit', async () => {
    let settings = settingsSnapshot('provider/small');
    const metadataResolvers = new Map<string, () => void>();
    const ports = createFakeChatPorts({
      models: {
        getModelOptions: () => [],
        getContextWindowSize: model => ({
          'provider/a': 200_000,
          'provider/b': 400_000,
        })[model] ?? 100_000,
        prepareModelMetadata: model => new Promise<void>((resolve) => {
          metadataResolvers.set(model, resolve);
        }),
      },
      settings: {
        getSettingsSnapshot: () => ({ ...settings }),
        commitSettingsSnapshot: async next => { settings = { ...next }; },
      },
    });
    const state = new ChatState();
    state.usage = {
      contextTokens: 50_000,
      contextWindow: 100_000,
      inputTokens: 50_000,
      model: 'provider/small',
      percentage: 50,
    };
    const tab = createToolbarTab(state);
    wireComposerChrome(tab, asPiviPlugin(createMockPiviPluginStub()), ports);

    tab.ui.composerActions?.setModel('provider/a');
    await Promise.resolve();
    await Promise.resolve();
    tab.ui.composerActions?.setModel('provider/b');
    await Promise.resolve();
    await Promise.resolve();
    expect(state.usage).toMatchObject({ contextWindow: 400_000, model: 'provider/b' });

    metadataResolvers.get('provider/a')?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.usage).toMatchObject({ contextWindow: 400_000, model: 'provider/b' });

    metadataResolvers.get('provider/b')?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.usage).toMatchObject({ contextWindow: 400_000, model: 'provider/b' });
  });
});
